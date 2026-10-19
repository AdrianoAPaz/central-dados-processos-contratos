import { Router } from 'express';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
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

// Sub-recursos de um processo administrativo do Betha Compras Cloud (ver
// SUBRECURSOS_PROCESSO em browser-extension/src/shared/constants.js; `anexos`
// são os metadados dos arquivos, montados pela extensão). Só estes `tipo`
// são aceitos no corpo; o valor é o nome da aba no relatório em Excel.
const TIPOS_SUBRECURSO: Record<string, string> = {
  itens: 'Itens',
  lotes: 'Lotes',
  participantes: 'Participantes',
  propostas: 'Propostas',
  despesas: 'Despesas',
  sessoesjulgamento: 'Sessões de julgamento',
  pareceres: 'Pareceres',
  atosfinais: 'Atos finais',
  historico: 'Histórico',
  atas: 'Atas de registro de preços',
  textos: 'Textos',
  anexos: 'Anexos',
};

function inteiro(valor: unknown): number | null {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function texto(valor: unknown): string | null {
  return valor != null && valor !== '' ? String(valor) : null;
}

function data(valor: unknown): Date | null {
  if (typeof valor !== 'string' || !valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function listaDe(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? (valor as Record<string, unknown>[]) : [];
}

// Body esperado: o JSON cru de um registro de `processosadministrativo` do
// Betha Compras Cloud, mais três campos que a extensão acrescenta —
// `exercicio` e `entidadeToken` (o contexto da sessão: o ano do processo É o
// exercício, e o id só é único dentro da entidade) e `subrecursos` (um array
// por tipo, buscado à parte em processosadministrativo/{id}/<subrecurso>,
// nunca dentro de `dadosBrutos`). Nomes de campo confirmados no projeto irmão
// Delta Intelligence (betha/selectors.md).
function mapearProcesso(body: Record<string, unknown>) {
  const { subrecursos, exercicio, entidadeToken, ...raw } = body;
  void subrecursos;

  const idBetha = inteiro(raw.id);
  if (idBetha == null) {
    throw new Error('Campo obrigatório ausente: id');
  }

  const numero = inteiro(raw.numeroProcesso);
  const ano = inteiro(exercicio);
  const tipoObjeto = raw.tipoObjeto as Record<string, unknown> | undefined;
  const valorTotalItens = raw.valorTotalItens != null && raw.valorTotalItens !== '' ? Number(raw.valorTotalItens) : null;

  return {
    entidadeToken: typeof entidadeToken === 'string' ? entidadeToken.slice(0, 200) : '',
    idBetha,
    numero,
    ano,
    numeroFormatado: numero != null ? (ano != null ? `${numero}/${ano}` : String(numero)) : null,
    objeto: texto(raw.objeto),
    modalidade: texto(tipoObjeto?.tipoDescricao ?? tipoObjeto?.descricao),
    situacao: texto(raw.situacao),
    situacaoDesc: texto(raw.situacaoDesc),
    dataProcesso: data(raw.dataProcesso),
    valorTotalItens: valorTotalItens != null && Number.isFinite(valorTotalItens) ? String(valorTotalItens) : null,
    quantidadeItens: inteiro(raw.quantidadeItens),
    dadosBrutos: raw as Prisma.InputJsonObject,
  };
}

processosRouter.get('/', async (_req, res) => {
  const [processos, contagens] = await Promise.all([
    prisma.processoAdministrativo.findMany({
      orderBy: { atualizadoEm: 'desc' },
      select: {
        id: true,
        idBetha: true,
        numeroFormatado: true,
        objeto: true,
        modalidade: true,
        situacaoDesc: true,
        dataProcesso: true,
        valorTotalItens: true,
        atualizadoEm: true,
      },
    }),
    prisma.subrecursoProcesso.groupBy({ by: ['processoId', 'tipo'], _count: { _all: true } }),
  ]);

  const porProcesso = new Map<string, Record<string, number>>();
  for (const c of contagens) {
    const mapa = porProcesso.get(c.processoId) ?? {};
    mapa[c.tipo] = c._count._all;
    porProcesso.set(c.processoId, mapa);
  }

  res.json(processos.map((p) => ({ ...p, contagens: porProcesso.get(p.id) ?? {} })));
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

  const recebidos = (body.subrecursos ?? {}) as Record<string, unknown>;

  // Reimportar sempre substitui os sub-recursos anteriores (evita duplicar ou
  // deixar órfão o que foi removido no Compras) — mesma regra dos contratos.
  const processo = await prisma.$transaction(async (tx) => {
    const { entidadeToken, idBetha } = dados;
    const salvo = await tx.processoAdministrativo.upsert({
      where: { entidadeToken_idBetha: { entidadeToken, idBetha } },
      create: dados,
      update: dados,
    });

    await tx.subrecursoProcesso.deleteMany({ where: { processoId: salvo.id } });
    await tx.subrecursoProcesso.createMany({
      data: Object.keys(TIPOS_SUBRECURSO).flatMap((tipo) =>
        listaDe(recebidos[tipo]).map((raw, i) => ({
          processoId: salvo.id,
          tipo,
          ordem: i + 1,
          dadosBrutos: raw as Prisma.InputJsonObject,
        })),
      ),
    });

    return salvo;
  });

  res.status(201).json(processo);
});

function buscarProcesso(id: string) {
  return prisma.processoAdministrativo.findUnique({
    where: { id },
    include: { subrecursos: { orderBy: [{ tipo: 'asc' }, { ordem: 'asc' }] } },
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

// Valor exibido de um campo de processo/sub-recurso — além do que
// valorCelulaDinamica já simplifica, a unidade de medida do Betha vem como
// `{ simbolo }` (ex.: "UN") e cairia no JSON cru. Mesma regra do valorProcesso
// da extensão (browser-extension/src/shared/campos-relatorio-processo.js).
function valorCelulaProcesso(chave: string, valor: unknown): string | number {
  if (valor != null && typeof valor === 'object' && !Array.isArray(valor)) {
    const simbolo = (valor as Record<string, unknown>).simbolo;
    if (simbolo != null) return String(simbolo);
  }
  return valorCelulaDinamica(chave, valor);
}

// Tabela com uma linha por registro e uma coluna por chave encontrada (união
// das chaves de todos os registros, na ordem em que aparecem) — o catálogo de
// campos dos sub-recursos não foi mapeado, então não há colunas fixas.
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
    planilha.addRow(Object.fromEntries(chaves.map((chave) => [chave, valorCelulaProcesso(chave, raw[chave])])));
  }
}

// Sub-recursos que viram uma aba dentro do Excel do próprio processo; os
// demais (abaixo) viram um arquivo .xlsx próprio dentro do zip — mesmo
// princípio do relatório de contrato (um documento por arquivo) e do PDF da
// extensão (browser-extension/src/shared/pdf-relatorio-processo.js).
const TIPOS_EM_ABA_DO_PROCESSO = ['itens', 'lotes', 'participantes', 'anexos'];

// tipo -> nome usado no título do arquivo ("pareceres do processo 45/2026").
const TIPOS_EM_ARQUIVO_PROPRIO: Record<string, string> = {
  pareceres: 'pareceres',
  sessoesjulgamento: 'sessões de julgamento',
  atosfinais: 'atos finais',
  despesas: 'despesas',
  historico: 'histórico',
  atas: 'atas de registro de preços',
  textos: 'textos',
};

type ProcessoCompleto = NonNullable<Awaited<ReturnType<typeof buscarProcesso>>>;

function tituloProcesso(processo: { numeroFormatado: string | null; idBetha: number }): string {
  return `processo ${processo.numeroFormatado ?? `id ${processo.idBetha}`}`;
}

// Workbook do processo: aba "Processo" (campo/valor com todos os campos) +
// uma aba por sub-recurso de TIPOS_EM_ABA_DO_PROCESSO que tenha registros.
function workbookProcesso(processo: ProcessoCompleto): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  preencherPlanilhaCamposDinamicos(workbook.addWorksheet('Processo'), processo.dadosBrutos as Record<string, unknown>, valorCelulaProcesso);

  for (const tipo of TIPOS_EM_ABA_DO_PROCESSO) {
    const registros = processo.subrecursos.filter((s) => s.tipo === tipo);
    if (registros.length > 0) {
      preencherPlanilhaTabelaDinamica(workbook.addWorksheet(TIPOS_SUBRECURSO[tipo].slice(0, 31)), registros);
    }
  }
  return workbook;
}

// Workbook de UM sub-recurso: todos os registros numa tabela, com todas as
// colunas que a API devolveu.
function workbookSubrecurso(registros: Array<{ dadosBrutos: unknown }>, nomeAba: string): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  preencherPlanilhaTabelaDinamica(workbook.addWorksheet(nomeAba.slice(0, 31)), registros);
  return workbook;
}

// Workbook só dos participantes: aba "Participantes" e, ao lado, a aba
// "Propostas" (uma linha por proposta, com `participanteId`/`participanteNome`
// pra ligar cada proposta ao seu participante).
function workbookParticipantes(processo: ProcessoCompleto): ExcelJS.Workbook | null {
  const participantes = processo.subrecursos.filter((s) => s.tipo === 'participantes');
  if (participantes.length === 0) return null;

  const workbook = new ExcelJS.Workbook();
  preencherPlanilhaTabelaDinamica(workbook.addWorksheet(TIPOS_SUBRECURSO.participantes), participantes);

  const propostas = processo.subrecursos.filter((s) => s.tipo === 'propostas');
  if (propostas.length > 0) {
    preencherPlanilhaTabelaDinamica(workbook.addWorksheet(TIPOS_SUBRECURSO.propostas), propostas);
  }
  return workbook;
}

// .zip com um Excel por documento (o processo e cada sub-recurso com
// registros) — mesmo formato do relatório de contrato.
processosRouter.get('/:id/relatorio', async (req, res) => {
  const processo = await buscarProcesso(req.params.id);
  if (!processo) {
    res.status(404).json({ error: 'Processo não encontrado' });
    return;
  }

  const titulo = tituloProcesso(processo);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug(titulo)}.zip"`);

  const arquivoZip = archiver('zip', { zlib: { level: 9 } });
  // Erro no meio da escrita do zip (ex.: stream do cliente fechada) não pode
  // virar exceção não tratada — derruba a resposta em vez de crashar o processo.
  arquivoZip.on('error', (err) => res.destroy(err));
  arquivoZip.pipe(res);

  arquivoZip.append(await workbookParaBuffer(workbookProcesso(processo)), { name: `${slug(titulo)}.xlsx` });

  const workbookDosParticipantes = workbookParticipantes(processo);
  if (workbookDosParticipantes) {
    arquivoZip.append(await workbookParaBuffer(workbookDosParticipantes), {
      name: `${slug(`participantes do ${titulo}`)}.xlsx`,
    });
  }

  for (const [tipo, rotulo] of Object.entries(TIPOS_EM_ARQUIVO_PROPRIO)) {
    const registros = processo.subrecursos.filter((s) => s.tipo === tipo);
    if (registros.length === 0) continue;
    const buffer = await workbookParaBuffer(workbookSubrecurso(registros, TIPOS_SUBRECURSO[tipo]));
    arquivoZip.append(buffer, { name: `${slug(`${rotulo} do ${titulo}`)}.xlsx` });
  }

  await arquivoZip.finalize();
});
