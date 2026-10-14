import { Router } from 'express';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import {
  formatarChave,
  preencherPlanilhaCamposDinamicos,
  slug,
  valorCelulaDinamica,
  workbookParaBuffer,
} from './contratos';

export const processosRouter = Router();

// Texto de um campo que pode vir como string ou como objeto de cadastro do
// Betha ({ descricao } / { nome }).
function texto(valor: unknown): string | null {
  if (valor == null) return null;
  if (typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;
    const interno = obj.descricao ?? obj.nome;
    return interno != null ? String(interno) : null;
  }
  return String(valor);
}

function inteiro(valor: unknown): number | null {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function listaDe(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? (valor as Record<string, unknown>[]) : [];
}

// Body esperado: o JSON cru de um registro de processo administrativo do
// Betha Compras Cloud, mais os sub-recursos buscados pela extensão em campos
// à parte (`lotes`, `itens`, `fornecedores`, `documentos` — nunca dentro de
// `dadosBrutos` do processo em si). O catálogo de campos do Compras ainda não
// foi confirmado ao vivo, então os campos achatados abaixo tentam alguns nomes
// candidatos e ficam nulos se nenhum existir — nada se perde, `dadosBrutos`
// guarda o JSON completo.
function mapearProcesso(body: Record<string, unknown>) {
  const { lotes, itens, fornecedores, documentos, ...raw } = body;
  void lotes;
  void itens;
  void fornecedores;
  void documentos;

  const idBetha = inteiro(raw.id);
  if (idBetha == null) {
    throw new Error('Campo obrigatório ausente: id');
  }

  const numero = inteiro(raw.numero ?? raw.numeroProcesso);
  const ano = inteiro(raw.ano ?? raw.exercicio);
  const entidade = raw.entidade as Record<string, unknown> | undefined;

  return {
    idBetha,
    numero,
    ano,
    numeroFormatado: numero != null ? (ano != null ? `${numero}/${ano}` : String(numero)) : null,
    objeto: texto(raw.objeto ?? raw.descricao),
    modalidade: texto(raw.modalidade),
    situacao: texto(raw.situacaoDesc ?? raw.situacao),
    entidadeNome: texto(entidade?.nome ?? raw.entidade),
    dadosBrutos: raw as Prisma.InputJsonObject,
  };
}

function comOrdem(registros: Record<string, unknown>[], processoId: string) {
  return registros.map((raw, i) => ({
    processoId,
    ordem: i + 1,
    dadosBrutos: raw as Prisma.InputJsonObject,
  }));
}

processosRouter.get('/', async (_req, res) => {
  const processos = await prisma.processoAdministrativo.findMany({
    orderBy: { atualizadoEm: 'desc' },
    select: {
      id: true,
      idBetha: true,
      numeroFormatado: true,
      objeto: true,
      modalidade: true,
      situacao: true,
      entidadeNome: true,
      atualizadoEm: true,
      _count: { select: { lotes: true, itens: true, fornecedores: true, documentos: true } },
    },
  });
  res.json(processos);
});

processosRouter.post('/', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  let dados;
  try {
    dados = mapearProcesso(body);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'JSON inválido' });
    return;
  }

  // Reimportar sempre substitui os sub-recursos anteriores (evita duplicar ou
  // deixar órfão o que foi removido no Compras) — mesma regra dos contratos.
  const processo = await prisma.$transaction(async (tx) => {
    const salvo = await tx.processoAdministrativo.upsert({
      where: { idBetha: dados.idBetha },
      create: dados,
      update: dados,
    });

    await tx.loteProcesso.deleteMany({ where: { processoId: salvo.id } });
    await tx.itemProcesso.deleteMany({ where: { processoId: salvo.id } });
    await tx.fornecedorProcesso.deleteMany({ where: { processoId: salvo.id } });
    await tx.documentoProcesso.deleteMany({ where: { processoId: salvo.id } });

    await tx.loteProcesso.createMany({ data: comOrdem(listaDe(body.lotes), salvo.id) });
    await tx.itemProcesso.createMany({ data: comOrdem(listaDe(body.itens), salvo.id) });
    await tx.fornecedorProcesso.createMany({ data: comOrdem(listaDe(body.fornecedores), salvo.id) });
    await tx.documentoProcesso.createMany({ data: comOrdem(listaDe(body.documentos), salvo.id) });

    return salvo;
  });

  res.status(201).json(processo);
});

function buscarProcesso(id: string) {
  return prisma.processoAdministrativo.findUnique({
    where: { id },
    include: {
      lotes: { orderBy: { ordem: 'asc' } },
      itens: { orderBy: { ordem: 'asc' } },
      fornecedores: { orderBy: { ordem: 'asc' } },
      documentos: { orderBy: { ordem: 'asc' } },
    },
  });
}

processosRouter.get('/:id', async (req, res) => {
  const processo = await buscarProcesso(req.params.id);
  if (!processo) {
    res.status(404).json({ error: 'Processo não encontrado' });
    return;
  }
  res.json(processo);
});

// Tabela com uma linha por registro e uma coluna por chave encontrada (união
// das chaves de todos os registros, na ordem em que aparecem) — o catálogo de
// campos dos sub-recursos do Compras não foi confirmado, então não há colunas
// fixas como nos itens de contrato.
function preencherPlanilhaTabelaDinamica(planilha: ExcelJS.Worksheet, registros: Array<{ dadosBrutos: unknown }>) {
  const chaves: string[] = [];
  for (const { dadosBrutos } of registros) {
    for (const chave of Object.keys((dadosBrutos ?? {}) as Record<string, unknown>)) {
      if (!chaves.includes(chave)) chaves.push(chave);
    }
  }

  planilha.columns = chaves.map((chave) => ({ header: formatarChave(chave), key: chave, width: 24 }));
  planilha.getRow(1).font = { bold: true };

  for (const { dadosBrutos } of registros) {
    const raw = (dadosBrutos ?? {}) as Record<string, unknown>;
    planilha.addRow(Object.fromEntries(chaves.map((chave) => [chave, valorCelulaDinamica(chave, raw[chave])])));
  }
}

// Um único .xlsx por processo: aba "Processo" (campo/valor) + uma aba por
// sub-recurso que tenha registros.
processosRouter.get('/:id/relatorio', async (req, res) => {
  const processo = await buscarProcesso(req.params.id);
  if (!processo) {
    res.status(404).json({ error: 'Processo não encontrado' });
    return;
  }

  const workbook = new ExcelJS.Workbook();
  preencherPlanilhaCamposDinamicos(workbook.addWorksheet('Processo'), processo.dadosBrutos as Record<string, unknown>);

  const abas: Array<[string, Array<{ dadosBrutos: unknown }>]> = [
    ['Lotes', processo.lotes],
    ['Itens', processo.itens],
    ['Fornecedores', processo.fornecedores],
    ['Documentos', processo.documentos],
  ];
  for (const [nome, registros] of abas) {
    if (registros.length > 0) preencherPlanilhaTabelaDinamica(workbook.addWorksheet(nome), registros);
  }

  const nomeArquivo = slug(`processo ${processo.numeroFormatado ?? `id ${processo.idBetha}`}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.xlsx"`);
  res.send(await workbookParaBuffer(workbook));
});
