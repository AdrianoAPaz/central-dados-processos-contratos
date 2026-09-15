import { Router } from 'express';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export const contratosRouter = Router();

// Body esperado: o JSON cru de um registro do endpoint `contratacoes` da API
// do Betha Contratos (copiado da aba Rede do navegador, por enquanto — este
// projeto ainda não tem integração ao vivo com o Betha). Ver Delta-Intelligence
// (CONTEXTO_PROJETO.md §5) para a lista completa de campos confirmados.
function mapearContrato(raw: Record<string, unknown>) {
  const tipoInstrumento = raw.tipoInstrumento as Record<string, unknown> | undefined;
  const fornecedor = raw.fornecedor as Record<string, unknown> | undefined;
  const fornecedorPessoa = fornecedor?.pessoa as Record<string, unknown> | undefined;
  const entidade = raw.entidade as Record<string, unknown> | undefined;
  const processo = raw.processoAdministrativo as Record<string, unknown> | undefined;

  const numeroTermo = raw.numeroTermo != null ? Number(raw.numeroTermo) : null;
  const ano = raw.ano != null ? Number(raw.ano) : null;

  if (raw.sequencial == null) {
    throw new Error('Campo obrigatório ausente: sequencial');
  }

  return {
    sequencial: Number(raw.sequencial),
    numeroTermo,
    ano,
    numeroFormatado: numeroTermo != null ? (ano ? `${numeroTermo}/${ano}` : String(numeroTermo)) : null,
    objeto: (raw.objetoContratacao as string) ?? null,
    situacao: (raw.situacao as string) ?? null,
    situacaoDesc: (raw.situacaoDesc as string) ?? null,
    tipoInstrumento: (tipoInstrumento?.classificacao as string) ?? null,
    tipoInstrumentoDesc: (tipoInstrumento?.descricao as string) ?? null,
    dataAssinatura: raw.dataAssinatura ? new Date(raw.dataAssinatura as string) : null,
    dataInicioVigencia: raw.dataInicioVigencia ? new Date(raw.dataInicioVigencia as string) : null,
    dataFimVigencia: raw.dataFimVigencia ? new Date(raw.dataFimVigencia as string) : null,
    valorOriginal: raw.valorOriginal != null ? String(raw.valorOriginal) : null,
    valorAditivos: raw.valorAditivos != null ? String(raw.valorAditivos) : null,
    valorSolFornec: raw.valorSolFornec != null ? String(raw.valorSolFornec) : null,
    fornecedorNome: (fornecedorPessoa?.nome as string) ?? null,
    fornecedorCpfCnpj: (fornecedorPessoa?.cpfCnpj as string) ?? null,
    entidadeNome: (entidade?.nome as string) ?? null,
    entidadeCnpj: (entidade?.cnpj as string) ?? null,
    processoNumero: processo?.numero != null ? Number(processo.numero) : null,
    processoAno: processo?.ano != null ? Number(processo.ano) : null,
    dadosBrutos: raw as Prisma.InputJsonObject,
  };
}

// Melhor palpite de um identificador próprio do aditivo (só para exibição —
// o catálogo de campos desse sub-recurso não foi confirmado ao vivo ainda).
// `ordem` (posição no array recebido) é quem garante a separação de verdade.
function extrairIdentificadorAditivo(raw: Record<string, unknown>): number | null {
  if (raw.sequencial != null && !Number.isNaN(Number(raw.sequencial))) return Number(raw.sequencial);
  if (raw.id != null && !Number.isNaN(Number(raw.id))) return Number(raw.id);
  return null;
}

contratosRouter.get('/', async (_req, res) => {
  const contratos = await prisma.contrato.findMany({
    orderBy: { criadoEm: 'desc' },
    select: {
      id: true,
      sequencial: true,
      numeroFormatado: true,
      objeto: true,
      fornecedorNome: true,
      situacaoDesc: true,
      criadoEm: true,
      _count: { select: { aditivos: true } },
    },
  });
  res.json(contratos);
});

contratosRouter.post('/', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  let dados;
  try {
    dados = mapearContrato(body);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'JSON inválido' });
    return;
  }

  const contrato = await prisma.contrato.upsert({
    where: { sequencial: dados.sequencial },
    create: dados,
    update: dados,
  });

  // Aditivos e itens vêm em campos à parte no corpo (buscados pela extensão
  // em contratacoes/{id}/aditivos e contratacoes/{id}/itens) — nunca dentro
  // de `dadosBrutos` do contrato em si. Reimportar sempre substitui os
  // anteriores (evita duplicar/deixar registro removido no Betha órfão
  // aqui). Deletar os aditivos já cria em cascata a remoção dos itens deles.
  await prisma.aditivo.deleteMany({ where: { contratoId: contrato.id } });
  await prisma.item.deleteMany({ where: { contratoId: contrato.id, aditivoId: null } });

  const aditivosRecebidos = Array.isArray(body.aditivos) ? (body.aditivos as Record<string, unknown>[]) : [];
  for (let i = 0; i < aditivosRecebidos.length; i++) {
    const raw = aditivosRecebidos[i];
    const { itens: itensDoAditivoRaw, ...dadosAditivo } = raw;
    const itensDoAditivo = Array.isArray(itensDoAditivoRaw) ? (itensDoAditivoRaw as Record<string, unknown>[]) : [];

    const aditivoCriado = await prisma.aditivo.create({
      data: {
        contratoId: contrato.id,
        ordem: i + 1,
        sequencial: extrairIdentificadorAditivo(raw),
        dadosBrutos: dadosAditivo as Prisma.InputJsonObject,
      },
    });

    if (itensDoAditivo.length) {
      await prisma.item.createMany({
        data: itensDoAditivo.map((itemRaw, j) => ({
          contratoId: contrato.id,
          aditivoId: aditivoCriado.id,
          ordem: j + 1,
          dadosBrutos: itemRaw as Prisma.InputJsonObject,
        })),
      });
    }
  }

  const itensDoContrato = Array.isArray(body.itens) ? (body.itens as Record<string, unknown>[]) : [];
  if (itensDoContrato.length) {
    await prisma.item.createMany({
      data: itensDoContrato.map((raw, i) => ({
        contratoId: contrato.id,
        aditivoId: null,
        ordem: i + 1,
        dadosBrutos: raw as Prisma.InputJsonObject,
      })),
    });
  }

  res.status(201).json(contrato);
});

contratosRouter.get('/:id', async (req, res) => {
  const contrato = await buscarContrato(req.params.id);
  if (!contrato) {
    res.status(404).json({ error: 'Contrato não encontrado' });
    return;
  }
  res.json(contrato);
});

const CAMPOS_RELATORIO: Array<{ label: string; valor: (c: NonNullable<Awaited<ReturnType<typeof buscarContrato>>>) => string | number | null }> = [
  { label: 'Sequencial', valor: (c) => c.sequencial },
  { label: 'Número/Ano', valor: (c) => c.numeroFormatado },
  { label: 'Tipo de instrumento', valor: (c) => c.tipoInstrumentoDesc },
  { label: 'Situação', valor: (c) => c.situacaoDesc },
  { label: 'Objeto', valor: (c) => c.objeto },
  { label: 'Fornecedor', valor: (c) => c.fornecedorNome },
  { label: 'CPF/CNPJ do fornecedor', valor: (c) => c.fornecedorCpfCnpj },
  { label: 'Entidade', valor: (c) => c.entidadeNome },
  { label: 'CNPJ da entidade', valor: (c) => c.entidadeCnpj },
  { label: 'Processo administrativo', valor: (c) => (c.processoNumero != null ? `${c.processoNumero}/${c.processoAno ?? ''}` : null) },
  { label: 'Data de assinatura', valor: (c) => formatarData(c.dataAssinatura) },
  { label: 'Início da vigência', valor: (c) => formatarData(c.dataInicioVigencia) },
  { label: 'Fim da vigência', valor: (c) => formatarData(c.dataFimVigencia) },
  { label: 'Valor original (R$)', valor: (c) => (c.valorOriginal != null ? Number(c.valorOriginal) : null) },
  { label: 'Valor de aditivos (R$)', valor: (c) => (c.valorAditivos != null ? Number(c.valorAditivos) : null) },
  { label: 'Valor de solicitações de fornecimento (R$)', valor: (c) => (c.valorSolFornec != null ? Number(c.valorSolFornec) : null) },
  { label: 'Quantidade de itens', valor: (c) => c.itens.length },
  { label: 'Quantidade de aditivos', valor: (c) => c.aditivos.length },
];

// Datas SEMPRE em dd/mm/aaaa neste relatório — nunca ISO (aaaa-mm-dd).
function formatarDataBr(d: Date): string {
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const ano = d.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}

function formatarData(data: Date | null): string | null {
  return data ? formatarDataBr(data) : null;
}

// Detecta string de data ISO (ex.: "2025-06-01" ou "2025-06-01T00:00:00Z")
// entre os campos dinâmicos de aditivo/item — o catálogo desses sub-recursos
// não define tipos, então datas chegam como string solta, não como Date.
function pareceDataIso(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(v);
}

// Simplifica objetos/listas comuns do Betha pra exibição em relatório —
// mostra só o dado que interessa em vez do objeto/array/string bruta. Ex.:
// - "2025-06-01T00:00:00Z" -> "01/06/2025"
// - contratacao: { numeroTermo, ano, ... } -> "86/2025"
// - tipoAditivo: { descricao, classificacao } -> "Aditivo de Prazo e Valor (Acréscimo)"
// - arquivos: [{ nome, id, tipo }, ...] -> "arquivo1.pdf, arquivo2.pdf"
function valorCelula(v: unknown): string | number {
  if (v == null) return '';
  if (typeof v === 'string' && pareceDataIso(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return formatarDataBr(d);
  }
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((item) => valorCelula(item)).join(', ');
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (obj.numeroTermo != null) return obj.ano != null ? `${obj.numeroTermo}/${obj.ano}` : String(obj.numeroTermo);
    if (obj.descricao != null) return String(obj.descricao);
    if (obj.nome != null) return String(obj.nome);
  }
  return JSON.stringify(v);
}

function buscarContrato(id: string) {
  return prisma.contrato.findUnique({
    where: { id },
    include: {
      itens: { where: { aditivoId: null }, orderBy: { ordem: 'asc' } },
      aditivos: {
        orderBy: { ordem: 'asc' },
        include: { itens: { orderBy: { ordem: 'asc' } } },
      },
    },
  });
}

// Rótulo usado pra identificar de qual aditivo uma linha de item veio —
// mesmo formato da coluna "Nº do aditivo" da aba Aditivos.
function rotuloAditivo(aditivo: { ordem: number; sequencial: number | null }): string {
  return aditivo.sequencial != null ? `${aditivo.ordem} (seq. ${aditivo.sequencial})` : String(aditivo.ordem);
}

// Gera colunas dinâmicas (união das chaves de todos os registros) + preenche
// uma planilha — usado tanto pra Itens do Contrato quanto pra Itens dos
// Aditivos, sempre com uma primeira coluna fixa de identificação.
function preencherPlanilhaDinamica(
  planilha: ExcelJS.Worksheet,
  colunaFixa: { header: string; key: string; width: number },
  linhas: Array<{ __fixo: string; raw: Record<string, unknown> }>,
) {
  const colunas: string[] = [];
  const vistas = new Set<string>();
  for (const linha of linhas) {
    if (linha.raw && typeof linha.raw === 'object') {
      for (const chave of Object.keys(linha.raw)) {
        if (!vistas.has(chave)) {
          vistas.add(chave);
          colunas.push(chave);
        }
      }
    }
  }

  planilha.columns = [colunaFixa, ...colunas.map((chave) => ({ header: chave, key: chave, width: 24 }))];
  planilha.getRow(1).font = { bold: true };

  for (const linha of linhas) {
    const registro: Record<string, unknown> = { [colunaFixa.key]: linha.__fixo };
    for (const chave of colunas) {
      registro[chave] = valorCelula(linha.raw[chave]);
    }
    planilha.addRow(registro);
  }
}

contratosRouter.get('/:id/relatorio', async (req, res) => {
  const contrato = await buscarContrato(req.params.id);
  if (!contrato) {
    res.status(404).json({ error: 'Contrato não encontrado' });
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet('Contrato');
  planilha.columns = [
    { header: 'Campo', key: 'campo', width: 36 },
    { header: 'Valor', key: 'valor', width: 48 },
  ];
  planilha.getRow(1).font = { bold: true };

  for (const campo of CAMPOS_RELATORIO) {
    planilha.addRow({ campo: campo.label, valor: campo.valor(contrato) ?? '' });
  }

  // Itens do contrato — abaixo dos dados do contrato num sentido lógico
  // (aba própria, já que Excel não empilha tabelas de tamanhos diferentes
  // na mesma planilha de forma legível).
  if (contrato.itens.length > 0) {
    const planilhaItens = workbook.addWorksheet('Itens do Contrato');
    preencherPlanilhaDinamica(
      planilhaItens,
      { header: 'Nº do item', key: '__numero', width: 14 },
      contrato.itens.map((item) => ({ __fixo: String(item.ordem), raw: item.dadosBrutos as Record<string, unknown> })),
    );
  }

  // Cada aditivo vira uma LINHA própria numa aba separada — sempre
  // identificado pelo nº de ordem (+ o sequencial do próprio aditivo, quando
  // existir), pra nunca misturar os dados de aditivos diferentes na mesma
  // célula. Colunas são geradas dinamicamente a partir do que cada aditivo
  // realmente trouxe (o catálogo de campos desse sub-recurso do Betha ainda
  // não foi confirmado ao vivo — ver mapearContrato acima).
  if (contrato.aditivos.length > 0) {
    const planilhaAditivos = workbook.addWorksheet('Aditivos');
    preencherPlanilhaDinamica(
      planilhaAditivos,
      { header: 'Nº do aditivo', key: '__numero', width: 18 },
      contrato.aditivos.map((aditivo) => ({ __fixo: rotuloAditivo(aditivo), raw: aditivo.dadosBrutos as Record<string, unknown> })),
    );
  }

  // Itens vinculados a aditivos — uma aba própria, com a primeira coluna
  // dizendo de qual aditivo cada item veio (mesmo rótulo da aba Aditivos).
  // Aditivos sem nenhum item simplesmente não aparecem aqui (normal numa
  // planilha); a ausência é explícita no relatório em PDF da extensão.
  const itensDeAditivos = contrato.aditivos.flatMap((aditivo) =>
    aditivo.itens.map((item) => ({ __fixo: rotuloAditivo(aditivo), raw: item.dadosBrutos as Record<string, unknown> })),
  );
  if (itensDeAditivos.length > 0) {
    const planilhaItensAditivos = workbook.addWorksheet('Itens dos Aditivos');
    preencherPlanilhaDinamica(planilhaItensAditivos, { header: 'Nº do aditivo', key: '__numero', width: 18 }, itensDeAditivos);
  }

  const nomeArquivo = `contrato-${contrato.numeroFormatado ?? contrato.sequencial}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  await workbook.xlsx.write(res);
  res.end();
});
