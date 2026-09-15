import { Router } from 'express';
import ExcelJS from 'exceljs';
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
    dadosBrutos: raw,
  };
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
    },
  });
  res.json(contratos);
});

contratosRouter.post('/', async (req, res) => {
  let dados;
  try {
    dados = mapearContrato(req.body ?? {});
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'JSON inválido' });
    return;
  }

  const contrato = await prisma.contrato.upsert({
    where: { sequencial: dados.sequencial },
    create: dados,
    update: dados,
  });
  res.status(201).json(contrato);
});

contratosRouter.get('/:id', async (req, res) => {
  const contrato = await prisma.contrato.findUnique({ where: { id: req.params.id } });
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
];

function formatarData(data: Date | null): string | null {
  return data ? data.toISOString().slice(0, 10) : null;
}

function buscarContrato(id: string) {
  return prisma.contrato.findUnique({ where: { id } });
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

  const nomeArquivo = `contrato-${contrato.numeroFormatado ?? contrato.sequencial}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  await workbook.xlsx.write(res);
  res.end();
});
