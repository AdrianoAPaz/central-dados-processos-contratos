import { Router } from 'express';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
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
      _count: { select: { aditivos: true, apostilamentos: true } },
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
  await prisma.apostilamento.deleteMany({ where: { contratoId: contrato.id } });
  await prisma.item.deleteMany({ where: { contratoId: contrato.id, aditivoId: null } });
  await prisma.solicitacaoFornecimento.deleteMany({ where: { contratoId: contrato.id } });
  await prisma.responsavelContrato.deleteMany({ where: { contratoId: contrato.id } });
  await prisma.interacaoContabilidade.deleteMany({ where: { contratoId: contrato.id } });
  await prisma.publicacaoContrato.deleteMany({ where: { contratoId: contrato.id } });
  await prisma.textoContrato.deleteMany({ where: { contratoId: contrato.id } });

  // Ordem de exibição é cronológica pelo sequencial do próprio aditivo (não a
  // ordem em que a API devolveu) — `ordem` já nasce refletindo isso, então
  // toda consulta que ordena por `ordem` (buscarContrato abaixo) já sai
  // correta sem precisar reordenar de novo em cada lugar.
  const aditivosRecebidos = (Array.isArray(body.aditivos) ? (body.aditivos as Record<string, unknown>[]) : [])
    .map((raw, indiceOriginal) => ({ raw, indiceOriginal, chave: extrairIdentificadorAditivo(raw) ?? Infinity }))
    .sort((a, b) => a.chave - b.chave || a.indiceOriginal - b.indiceOriginal)
    .map((x) => x.raw);

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

  // Apostilamentos (contratacoes/{id}/apostilamentos) — mesma ordenação
  // cronológica dos aditivos: `ordem` já nasce refletindo o sequencial.
  const apostilamentosRecebidos = (Array.isArray(body.apostilamentos) ? (body.apostilamentos as Record<string, unknown>[]) : [])
    .map((raw, indiceOriginal) => ({ raw, indiceOriginal, chave: extrairIdentificadorAditivo(raw) ?? Infinity }))
    .sort((a, b) => a.chave - b.chave || a.indiceOriginal - b.indiceOriginal)
    .map((x) => x.raw);
  if (apostilamentosRecebidos.length) {
    await prisma.apostilamento.createMany({
      data: apostilamentosRecebidos.map((raw, i) => ({
        contratoId: contrato.id,
        ordem: i + 1,
        sequencial: extrairIdentificadorAditivo(raw),
        dadosBrutos: raw as Prisma.InputJsonObject,
      })),
    });
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

  // Já vêm ordenadas pela própria API do Betha (sort: data desc,
  // numeroSolicitacao desc) — não reordenamos aqui, `ordem` só reflete a
  // posição recebida (ver comentário do model no schema.prisma). Recebimentos
  // vêm aninhados dentro de cada solicitação (campo `recebimentos`, buscado à
  // parte pela extensão em contratacoes/{id}/solicitacoesfornecimento/{sfId}/
  // recebimentos) — por isso precisa do id de cada solicitação já criada
  // antes de gravar os recebimentos dela, mesmo padrão do loop de
  // aditivos/itens acima.
  const solicitacoesFornecimento = Array.isArray(body.solicitacoesFornecimento)
    ? (body.solicitacoesFornecimento as Record<string, unknown>[])
    : [];
  for (let i = 0; i < solicitacoesFornecimento.length; i++) {
    const raw = solicitacoesFornecimento[i];
    const { recebimentos: recebimentosRaw, itens: itensSfRaw, ...dadosSf } = raw;
    const recebimentosDaSf = Array.isArray(recebimentosRaw) ? (recebimentosRaw as Record<string, unknown>[]) : [];
    const itensDaSf = Array.isArray(itensSfRaw) ? (itensSfRaw as Record<string, unknown>[]) : [];

    const sfCriada = await prisma.solicitacaoFornecimento.create({
      data: {
        contratoId: contrato.id,
        ordem: i + 1,
        dadosBrutos: dadosSf as Prisma.InputJsonObject,
      },
    });

    // Itens vinculados à solicitação (campo `itens`, buscado à parte pela
    // extensão em .../solicitacoesfornecimento/{sfId}/itens).
    if (itensDaSf.length) {
      await prisma.itemSolicitacaoFornecimento.createMany({
        data: itensDaSf.map((itemRaw, k) => ({
          solicitacaoId: sfCriada.id,
          ordem: k + 1,
          dadosBrutos: itemRaw as Prisma.InputJsonObject,
        })),
      });
    }

    // Itens de cada recebimento (o que efetivamente foi recebido do
    // catálogo) vêm aninhados dentro dele (campo `itens`, buscado à parte
    // pela extensão em .../recebimentos/{recebimentoId}/itens) — mesmo
    // motivo do loop de solicitações/recebimentos acima pra não usar
    // createMany: precisa do id de cada recebimento já criado antes de
    // gravar os itens dele.
    for (let j = 0; j < recebimentosDaSf.length; j++) {
      const recebimentoRaw = recebimentosDaSf[j];
      const { itens: itensRecebimentoRaw, ...dadosRecebimento } = recebimentoRaw;
      const itensDoRecebimento = Array.isArray(itensRecebimentoRaw) ? (itensRecebimentoRaw as Record<string, unknown>[]) : [];

      const recebimentoCriado = await prisma.recebimento.create({
        data: {
          solicitacaoId: sfCriada.id,
          ordem: j + 1,
          dadosBrutos: dadosRecebimento as Prisma.InputJsonObject,
        },
      });

      if (itensDoRecebimento.length) {
        await prisma.itemRecebimento.createMany({
          data: itensDoRecebimento.map((itemRaw, k) => ({
            recebimentoId: recebimentoCriado.id,
            ordem: k + 1,
            dadosBrutos: itemRaw as Prisma.InputJsonObject,
          })),
        });
      }
    }
  }

  // Responsáveis do contrato (fiscal, gestor etc.) — endpoint confirmado ao
  // vivo pelo usuário (2026-09-17): contratacoes/{id}/responsaveiscontratacao.
  // Mesma regra dos demais sub-recursos: `ordem` reflete a posição recebida.
  const responsaveis = Array.isArray(body.responsaveis) ? (body.responsaveis as Record<string, unknown>[]) : [];
  if (responsaveis.length) {
    await prisma.responsavelContrato.createMany({
      data: responsaveis.map((raw, i) => ({
        contratoId: contrato.id,
        ordem: i + 1,
        dadosBrutos: raw as Prisma.InputJsonObject,
      })),
    });
  }

  // Interações contábeis (empenhar/liquidar/pagar) — endpoint confirmado ao
  // vivo pelo usuário (2026-09-17): contratacoes/{id}/interacaocontabil/
  // integracao-filtros (ver browser-extension/src/background/service-worker.js).
  // Mesma regra dos demais sub-recursos: `ordem` reflete a posição recebida.
  const interacoesContabilidade = Array.isArray(body.interacoesContabilidade)
    ? (body.interacoesContabilidade as Record<string, unknown>[])
    : [];
  if (interacoesContabilidade.length) {
    await prisma.interacaoContabilidade.createMany({
      data: interacoesContabilidade.map((raw, i) => ({
        contratoId: contrato.id,
        ordem: i + 1,
        dadosBrutos: raw as Prisma.InputJsonObject,
      })),
    });
  }

  // Publicações (janela "Publicação" do contrato) — caminho
  // contratacoes/{id}/publicacoes ainda não confirmado ao vivo. Mesma regra
  // dos demais sub-recursos: `ordem` reflete a posição recebida.
  const publicacoes = Array.isArray(body.publicacoes) ? (body.publicacoes as Record<string, unknown>[]) : [];
  if (publicacoes.length) {
    await prisma.publicacaoContrato.createMany({
      data: publicacoes.map((raw, i) => ({
        contratoId: contrato.id,
        ordem: i + 1,
        dadosBrutos: raw as Prisma.InputJsonObject,
      })),
    });
  }

  // Textos (rotina "Textos" do contrato) — já com `arquivos` completos pela
  // extensão. Mesma regra dos demais sub-recursos.
  const textos = Array.isArray(body.textos) ? (body.textos as Record<string, unknown>[]) : [];
  if (textos.length) {
    await prisma.textoContrato.createMany({
      data: textos.map((raw, i) => ({
        contratoId: contrato.id,
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

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}

// Valores em enum do Betha (ex.: CONTRATACAO_DIRETA) como aparecem na tela.
// Mesmo mapa de browser-extension/src/shared/campos-relatorio.js.
const ROTULOS_ENUM: Record<string, string> = {
  CONTRATACAO_DIRETA: 'Contratação direta',
  LICITACAO: 'Licitação',
  QUANTIDADE: 'Quantidade',
  VALOR: 'Valor',
};

function rotuloEnum(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const chave = v.trim();
  if (ROTULOS_ENUM[chave]) return ROTULOS_ENUM[chave];
  const texto = chave.replace(/_/g, ' ').toLowerCase();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function simNao(v: unknown): string | null {
  return v == null ? null : v ? 'Sim' : 'Não';
}

function textoFundamentoLegal(v: unknown): string | null {
  const f = obj(v);
  if (typeof f.descricao === 'string' && f.descricao) return f.descricao;
  const partes = [
    f.leiFormatado ? `Lei ${String(f.leiFormatado)}` : '',
    f.artigo != null ? `Art. ${String(f.artigo)}` : '',
    f.inciso ? String(f.inciso) : '',
  ].filter(Boolean);
  return partes.length ? partes.join(', ') : null;
}

type ContratoRelatorio = NonNullable<Awaited<ReturnType<typeof buscarContrato>>>;

// Campos da tela "Informações gerais" do contrato que não têm coluna própria
// no banco — saem do JSON cru (`dadosBrutos`).
function origemProcessoBruto(c: ContratoRelatorio): Obj {
  return obj(obj(c.dadosBrutos).processoAdministrativoContratoBO);
}

function entidadeOrigemProcesso(c: ContratoRelatorio): string | null {
  const bruto = obj(c.dadosBrutos);
  const origem = obj(obj(bruto.processoAdministrativo).entidade);
  if (typeof origem.nome === 'string' && origem.nome) return origem.nome;
  const entidade = obj(bruto.entidade);
  return origem.id != null && origem.id === entidade.id ? ((entidade.nome as string) ?? null) : null;
}

function quantidadeDeDias(c: ContratoRelatorio): number | null {
  if (!c.dataInicioVigencia || !c.dataFimVigencia) return null;
  return Math.round((c.dataFimVigencia.getTime() - c.dataInicioVigencia.getTime()) / 86400000);
}

const CAMPOS_RELATORIO: Array<{ label: string; valor: (c: ContratoRelatorio) => string | number | null }> = [
  { label: 'Sequencial', valor: (c) => c.sequencial },
  { label: 'Número/Ano', valor: (c) => c.numeroFormatado },
  { label: 'Tipo de instrumento', valor: (c) => c.tipoInstrumentoDesc },
  { label: 'Situação', valor: (c) => c.situacaoDesc },
  { label: 'Objeto', valor: (c) => c.objeto },
  { label: 'Fornecedor', valor: (c) => c.fornecedorNome },
  { label: 'CPF/CNPJ do fornecedor', valor: (c) => c.fornecedorCpfCnpj },
  { label: 'Entidade', valor: (c) => c.entidadeNome },
  { label: 'CNPJ da entidade', valor: (c) => c.entidadeCnpj },
  { label: 'Origem', valor: (c) => (obj(c.dadosBrutos).origemDesc as string) ?? rotuloEnum(obj(c.dadosBrutos).origem) },
  { label: 'Entidade origem do processo', valor: (c) => entidadeOrigemProcesso(c) },
  { label: 'Processo administrativo', valor: (c) => (c.processoNumero != null ? `${c.processoNumero}/${c.processoAno ?? ''}` : null) },
  {
    label: 'Forma de contratação',
    valor: (c) => rotuloEnum(obj(c.dadosBrutos).formaContratacao ?? origemProcessoBruto(c).tipoContratacao),
  },
  { label: 'Modalidade', valor: (c) => (origemProcessoBruto(c).descricaoModalidade as string) ?? null },
  { label: 'Fundamento legal', valor: (c) => textoFundamentoLegal(obj(c.dadosBrutos).fundamentacaoLegal) },
  {
    label: 'Nº/ano da licitação',
    valor: (c) => {
      const o = origemProcessoBruto(c);
      return o.numeroSequencial != null ? `${String(o.numeroSequencial)}/${o.anoSequencial != null ? String(o.anoSequencial) : ''}` : null;
    },
  },
  {
    label: 'Tipo de objeto',
    valor: (c) => {
      const t = obj(obj(c.dadosBrutos).tipoObjeto);
      return ((t.descricao ?? t.tipoDescricao) as string) ?? null;
    },
  },
  { label: 'Controlar saldo por', valor: (c) => rotuloEnum(obj(c.dadosBrutos).tipoControleSaldo) },
  { label: 'Controlar itens por organograma', valor: (c) => simNao(obj(c.dadosBrutos).controlaSaldoOrganograma) },
  { label: 'Orçamento sigiloso', valor: (c) => simNao(obj(c.dadosBrutos).orcamentoSigiloso) },
  { label: 'Data de assinatura', valor: (c) => formatarData(c.dataAssinatura) },
  { label: 'Início da vigência', valor: (c) => formatarData(c.dataInicioVigencia) },
  { label: 'Fim da vigência', valor: (c) => formatarData(c.dataFimVigencia) },
  { label: 'Quantidade de dias', valor: (c) => quantidadeDeDias(c) },
  { label: 'Vigência por prazo indeterminado', valor: (c) => simNao(obj(c.dadosBrutos).vigenciaIndeterminada) },
  { label: 'Valor original (R$)', valor: (c) => (c.valorOriginal != null ? Number(c.valorOriginal) : null) },
  { label: 'Valor de aditivos (R$)', valor: (c) => (c.valorAditivos != null ? Number(c.valorAditivos) : null) },
  { label: 'Valor de solicitações de fornecimento (R$)', valor: (c) => (c.valorSolFornec != null ? Number(c.valorSolFornec) : null) },
  { label: 'Quantidade de itens', valor: (c) => c.itens.length },
  { label: 'Quantidade de aditivos', valor: (c) => c.aditivos.length },
  { label: 'Quantidade de apostilamentos', valor: (c) => c.apostilamentos.length },
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
    // Fornecedor/responsável do Betha: o nome fica em `pessoa.nome` — mesma
    // regra do valorTexto da extensão (campos-relatorio.js).
    const pessoa = obj.pessoa as Record<string, unknown> | null | undefined;
    if (pessoa && typeof pessoa === 'object' && pessoa.nome != null) return String(pessoa.nome);
    // Objeto vazio (ex.: `protocolo: {}` do processo) não tem nada pra
    // conferir — fica em branco, igual a uma lista vazia.
    if (Object.keys(obj).length === 0) return '';
  }
  // Valor não reconhecido fica como JSON cru de propósito, pra um analista
  // conferir manualmente — não trocar por texto vazio/simplificado.
  return JSON.stringify(v);
}

// Campo "organograma" (unidade orçamentária) — pedido do usuário: além da
// descrição, mostrar também o código do organograma, que o fallback genérico
// de valorCelula descarta (mostra só `descricao`, igual faz pra tipoAditivo
// etc.). Restrito à chave "organograma" mesmo, não vale pra todo objeto que
// tiver um `codigo` solto. Mesma lógica do lado da extensão de navegador
// (browser-extension/src/shared/campos-relatorio.js).
function ehChaveOrganograma(chave: string): boolean {
  return /organograma/i.test(chave);
}

// Código do organograma como linha própria ("Código do organograma"), logo
// abaixo do "Organograma" — o objeto do Betha traz `numero` (ex.:
// "0200300203"). Mesma lógica do lado da extensão (codigoOrganograma em
// campos-relatorio.js).
function codigoOrganograma(valor: unknown): string {
  if (valor == null || typeof valor !== 'object' || Array.isArray(valor)) return '';
  const numero = (valor as Record<string, unknown>).numero;
  return numero != null && typeof numero !== 'object' ? String(numero).trim() : '';
}

// Campo "solicitacaoFornecimento" de uma interação contábil — pedido do
// usuário (2026-10-14): só interessa o número/ano formatado (`numeroAno`,
// ex.: "4641/2025"), não o objeto inteiro que o Betha devolve. Mesma lógica
// do lado da extensão (browser-extension/src/shared/campos-relatorio.js).
function valorSolicitacaoFornecimento(valor: unknown): string {
  const lista = Array.isArray(valor) ? valor : [valor];
  return lista
    .map((item) => (item != null && typeof item === 'object' ? (item as Record<string, unknown>).numeroAno : item))
    .filter((v) => v != null)
    .join(', ');
}

// Campo "desdobramento" de uma interação contábil: um objeto por rateio
// orçamentário, mas só interessa `item.desdobramento` (ex.: "33903900000000").
// Mesma lógica do lado da extensão (browser-extension/src/shared/campos-relatorio.js).
function valorDesdobramento(valor: unknown): string {
  const lista = Array.isArray(valor) ? valor : [valor];
  return lista
    .map((item) => (item != null && typeof item === 'object' ? (item as Record<string, unknown>).desdobramento : item))
    .filter((v) => v != null)
    .join(', ');
}

// Número da despesa (ex.: "291") de cada rateio do `desdobramento` —
// `despesa.numero` é injetado pela extensão (enriquecerNumerosDespesa em
// popup.js); sem ele fica em branco, nunca mostra o id interno no lugar.
function valorNumeroDespesa(valor: unknown): string {
  const lista = Array.isArray(valor) ? valor : [valor];
  return lista
    .map((item) => {
      const despesa = item != null && typeof item === 'object' ? (item as Record<string, unknown>).despesa : null;
      return despesa != null && typeof despesa === 'object' ? (despesa as Record<string, unknown>).numero : null;
    })
    .filter((v) => v != null)
    .join(', ');
}

// Número/ano do empenho (ex.: 5426/2026) gerado quando a interação é
// contabilizada: `empenhoContabilidadeBO.numeroEmpenho` de cada rateio do
// `desdobramento` (ou `numeroEmpenho` direto no rateio, no "Empenhar"). O
// ano vem em `empenhoContabilidadeBO.anoEmpenho` (confirmado no retorno real,
// em empenhar e liquidar); sem ele, mostra só o número. Interação não
// contabilizada fica em branco. Mesma lógica do lado da extensão
// (browser-extension/src/shared/campos-relatorio.js).
function anoDoEmpenho(...origens: unknown[]): string | null {
  for (const origem of origens) {
    const v = origem != null && typeof origem === 'object' ? (origem as Record<string, unknown>).anoEmpenho : null;
    if (typeof v === 'number' || (typeof v === 'string' && /^\d{4}$/.test(v.trim()))) return String(v).trim();
  }
  return null;
}

function valorNumeroEmpenho(raw: Record<string, unknown>): string {
  const situacao = raw.situacao ?? raw.situacaoDesc;
  if (typeof situacao !== 'string' || !/^contabilizad/i.test(situacao.trim())) return '';
  const lista = Array.isArray(raw.desdobramento) ? raw.desdobramento : [];
  const empenhos = lista
    .map((item) => {
      if (item == null || typeof item !== 'object') return null;
      const rateio = item as Record<string, unknown>;
      const bo = rateio.empenhoContabilidadeBO;
      const boObj = bo != null && typeof bo === 'object' ? (bo as Record<string, unknown>) : null;
      const numero = boObj?.numeroEmpenho != null ? boObj.numeroEmpenho : rateio.numeroEmpenho;
      if (numero == null) return null;
      const ano = anoDoEmpenho(boObj, rateio);
      return ano ? `${String(numero)}/${ano}` : String(numero);
    })
    .filter((v): v is string => v != null);
  return [...new Set(empenhos)].join(', ');
}

// Veículo de publicação (chave contém "veiculo"): o nome exibido é
// `fornecedor.pessoa.nome` do veículo. Mesma lógica do lado da extensão
// (browser-extension/src/shared/campos-relatorio.js).
function nomeVeiculo(item: unknown): string | number {
  const fornecedor = item != null && typeof item === 'object' ? (item as Record<string, unknown>).fornecedor : null;
  const pessoa = fornecedor != null && typeof fornecedor === 'object' ? (fornecedor as Record<string, unknown>).pessoa : null;
  const nome = pessoa != null && typeof pessoa === 'object' ? (pessoa as Record<string, unknown>).nome : null;
  return nome != null ? String(nome) : valorCelula(item);
}

// Entidade (`entidade`, `entidadeContrato`, `entidadeParticipante`…) — o
// Betha costuma devolver só `{ id }`, mas o cadastro completo, com `nome`,
// aparece em outro ponto do mesmo registro. `indexarEntidades` varre o
// registro inteiro e monta id -> nome só a partir de objetos sob chaves de
// entidade. Mesma lógica do lado da extensão
// (browser-extension/src/shared/campos-relatorio.js).
function ehChaveEntidade(chave: string): boolean {
  return /^entidade/i.test(chave);
}

export function indexarEntidades(raiz: unknown): Map<string, string> {
  const nomes = new Map<string, string>();
  const visitar = (no: unknown, chave: string) => {
    if (Array.isArray(no)) {
      no.forEach((item) => visitar(item, chave));
      return;
    }
    if (no == null || typeof no !== 'object') return;
    const obj = no as Record<string, unknown>;
    if (ehChaveEntidade(chave) && obj.id != null && obj.nome != null && !nomes.has(String(obj.id))) {
      nomes.set(String(obj.id), String(obj.nome));
    }
    for (const [k, v] of Object.entries(obj)) visitar(v, k);
  };
  visitar(raiz, '');
  return nomes;
}

// `entidadeParticipante` (despesas do processo) embrulha a entidade em
// `{ entidade: { id }, orgaoExterno }`. Devolve null quando não resolve, pra
// cair no valorCelula (e no JSON cru).
function nomeEntidade(valor: Record<string, unknown>, entidades?: Map<string, string>): string | number | null {
  const interna = valor.entidade;
  const alvo = interna != null && typeof interna === 'object' ? (interna as Record<string, unknown>) : valor;
  if (alvo.nome != null) return String(alvo.nome);
  const nome = alvo.id != null ? entidades?.get(String(alvo.id)) : undefined;
  if (nome) return nome;
  if (valor.orgaoExterno != null && typeof valor.orgaoExterno === 'object' && interna == null) return valorCelula(valor.orgaoExterno);
  return null;
}

export type ContextoCelula = { entidades?: Map<string, string> };

// `contexto.entidades` vem de indexarEntidades (opcional — sem ele, entidade
// só com id fica como JSON cru).
export function valorCelulaDinamica(chave: string, valor: unknown, contexto: ContextoCelula = {}): string | number {
  if (ehChaveEntidade(chave) && valor != null && typeof valor === 'object' && !Array.isArray(valor)) {
    const nome = nomeEntidade(valor as Record<string, unknown>, contexto.entidades);
    if (nome != null) return nome;
  }
  if (chave === 'solicitacaoFornecimento' && valor != null) {
    return valorSolicitacaoFornecimento(valor);
  }
  if (/veiculo/i.test(chave) && valor != null && typeof valor === 'object') {
    return Array.isArray(valor) ? valor.map(nomeVeiculo).join(', ') : nomeVeiculo(valor);
  }
  if (chave === 'desdobramento' && valor != null) {
    return valorDesdobramento(valor);
  }
  if (ehChaveOrganograma(chave) && valor != null && typeof valor === 'object' && !Array.isArray(valor)) {
    const obj = valor as Record<string, unknown>;
    const descricao = obj.descricao != null ? String(obj.descricao) : '';
    const codigo = obj.codigo != null ? String(obj.codigo) : '';
    if (descricao && codigo) return `${descricao} (${codigo})`;
  }
  return valorCelula(valor);
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
      apostilamentos: { orderBy: { ordem: 'asc' } },
      solicitacoesFornecimento: {
        orderBy: { ordem: 'asc' },
        include: {
          itens: { orderBy: { ordem: 'asc' } },
          recebimentos: {
            orderBy: { ordem: 'asc' },
            include: { itens: { orderBy: { ordem: 'asc' } } },
          },
        },
      },
      responsaveis: { orderBy: { ordem: 'asc' } },
      interacoesContabilidade: { orderBy: { ordem: 'asc' } },
      publicacoes: { orderBy: { ordem: 'asc' } },
      textos: { orderBy: { ordem: 'asc' } },
    },
  });
}

// Responsáveis do contrato (fiscal, gestor etc.) em seção/planilha própria —
// pedido do usuário: nome, tipo e período de cada um, não misturados nos
// campos do contrato. Formato confirmado ao vivo pelo usuário (2026-09-17)
// contra o retorno real do sub-recurso `responsaveiscontratacao`: nome em
// `responsavel.pessoa.nome`, tipo em `tipoResponsavelContrato.descricao`,
// período em `dataInicioResponsabilidade`/`dataFinalResponsabilidade`.
function extrairResponsavel(raw: Record<string, unknown>): { nome: string | null; tipo: string | null; periodo: string | null } {
  const responsavel = (raw.responsavel ?? {}) as Record<string, unknown>;
  const pessoa = (responsavel.pessoa ?? {}) as Record<string, unknown>;
  const tipoResponsavelContrato = (raw.tipoResponsavelContrato ?? {}) as Record<string, unknown>;
  const nome = (pessoa.nome as string | undefined) ?? (raw.nome as string | undefined) ?? null;
  const tipo = (tipoResponsavelContrato.descricao as string | undefined) ?? null;
  const periodo = formatarPeriodoResponsavel(
    raw.dataInicioResponsabilidade as string | undefined,
    raw.dataFinalResponsabilidade as string | undefined,
  );
  return { nome, tipo, periodo };
}

function formatarPeriodoResponsavel(inicioIso?: string, fimIso?: string): string | null {
  const inicio = inicioIso ? formatarData(new Date(inicioIso)) : null;
  const fim = fimIso ? formatarData(new Date(fimIso)) : null;
  if (inicio && fim) return `${inicio} a ${fim}`;
  if (inicio) return `A partir de ${inicio}`;
  if (fim) return `Até ${fim}`;
  return null;
}

// Formata chave camelCase pra rótulo legível (ex.: "tipoAditivo" -> "Tipo
// Aditivo") — mesma lógica do lado da extensão de navegador
// (browser-extension/src/shared/campos-relatorio.js), pra manter os dois
// relatórios consistentes.
export function formatarChave(chave: string): string {
  return chave.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

// Colunas fixas do relatório de itens (pedido do usuário: só isso interessa,
// não o restante do catálogo bruto do Betha). Cada campo tenta várias chaves
// candidatas, em ordem — `qtdItem`/`valorItem`/`valorTotal`/`unidadeMedida`
// confirmados ao vivo pelo usuário (2026-09-16, item de aditivo); "Nº do
// item"/"Descrição" ainda não, mantidos como palpite defensivo. `extrair` tem
// prioridade sobre `chaves` quando presente — usado pros dois campos que só
// existem aninhados num sub-objeto (confirmado ao vivo pelo usuário,
// 2026-09-16, item do contrato em si, não de aditivo):
// unidadeMedida.simbolo (ex.: "MES") e itemPropostaBO.valorUnitarioPercentual.
// No item de ADITIVO, `unidadeMedida` vem como string pronta (ex.: "UN",
// confirmado ao vivo pelo usuário, 2026-09-23), com o objeto completo só em
// especificacao.unidadeMedida — por isso o extrator aceita os dois formatos.
function extrairUnidade(raw: Record<string, unknown>): unknown {
  const u = raw.unidadeMedida
  if (typeof u === 'string' && u.trim()) return u.trim()
  if (u && typeof u === 'object' && (u as Record<string, unknown>).simbolo) return (u as Record<string, unknown>).simbolo
  const especificacao = raw.especificacao as Record<string, unknown> | undefined
  const daEspecificacao = especificacao?.unidadeMedida
  return daEspecificacao && typeof daEspecificacao === 'object'
    ? (daEspecificacao as Record<string, unknown>).simbolo
    : undefined
}

const CAMPOS_ITEM: Array<{ header: string; key: string; chaves: string[]; extrair?: (raw: Record<string, unknown>) => unknown; moeda?: boolean }> = [
  { header: 'Nº do item', key: 'numero', chaves: ['numero', 'numeroItem', 'item', 'ordem'] },
  { header: 'Descrição', key: 'descricao', chaves: ['material', 'especificacao', 'descricaoItem', 'descricao'] },
  {
    header: 'Unidade',
    key: 'unidade',
    chaves: ['unidade', 'unidade_medida', 'undMedida'],
    extrair: extrairUnidade,
  },
  { header: 'Quantidade', key: 'quantidade', chaves: ['qtdItem', 'quantidade', 'qtde', 'qtd'] },
  {
    header: 'Valor unitário (R$)',
    key: 'valorUnitario',
    // `vlUnitario` confirmado ao vivo pelo usuário (2026-09-17, item de
    // recebimento) — chave própria desse sub-recurso, diferente das demais.
    chaves: ['valorItem', 'valorUnitario', 'valorUnit', 'precoUnitario', 'vlUnitario'],
    extrair: (raw) => (raw.itemPropostaBO as Record<string, unknown> | undefined)?.valorUnitarioPercentual,
    moeda: true,
  },
  // `vlTotal` confirmado ao vivo pelo usuário (2026-09-17, item de
  // recebimento) — chave própria desse sub-recurso, diferente das demais.
  { header: 'Valor total (R$)', key: 'valorTotal', chaves: ['valorTotal', 'valor', 'vlTotal'], moeda: true },
];

function extrairCampoItem(raw: Record<string, unknown>, campo: { chaves: string[]; extrair?: (raw: Record<string, unknown>) => unknown }): unknown {
  if (campo.extrair) {
    const viaExtrator = campo.extrair(raw);
    if (viaExtrator !== undefined && viaExtrator !== null) return viaExtrator;
  }
  for (const chave of campo.chaves) {
    if (raw[chave] !== undefined) return raw[chave];
  }
  return undefined;
}

// Preenche a aba "Itens" (do contrato ou de um aditivo) com as colunas FIXAS
// de CAMPOS_ITEM — não colunas dinâmicas, já que o catálogo de itens em si é
// conhecido. `colunaFixa` existe pra um eventual identificador extra no
// futuro; hoje as duas chamadas passam `null`.
function preencherPlanilhaItens(
  planilha: ExcelJS.Worksheet,
  colunaFixa: { header: string; key: string; width: number } | null,
  linhas: Array<{ __fixo: string; raw: Record<string, unknown> }>,
) {
  planilha.columns = [
    ...(colunaFixa ? [colunaFixa] : []),
    ...CAMPOS_ITEM.map((c) => ({ header: c.header, key: c.key, width: 22 })),
  ];
  planilha.getRow(1).font = { bold: true };

  for (const linha of linhas) {
    const registro: Record<string, unknown> = colunaFixa ? { [colunaFixa.key]: linha.__fixo } : {};
    for (const campo of CAMPOS_ITEM) {
      const bruto = extrairCampoItem(linha.raw, campo);
      registro[campo.key] = campo.moeda && bruto != null ? Number(bruto) : valorCelula(bruto);
    }
    planilha.addRow(registro);
  }
}

// Planilha campo/valor (2 colunas) — mesmo formato usado pra aba "Contrato"
// (CAMPOS_RELATORIO), agora reaproveitado pros documentos de aditivo e de
// solicitação de fornecimento também.
function preencherPlanilhaCampos(planilha: ExcelJS.Worksheet, linhas: Array<{ campo: string; valor: string | number | null }>) {
  planilha.columns = [
    { header: 'Campo', key: 'campo', width: 36 },
    { header: 'Valor', key: 'valor', width: 48 },
  ];
  planilha.getRow(1).font = { bold: true };

  for (const linha of linhas) {
    planilha.addRow({ campo: linha.campo, valor: linha.valor ?? '' });
  }
}

// Mesma planilha campo/valor, mas a partir do JSON cru de um aditivo/
// solicitação de fornecimento — catálogo de campos desses sub-recursos não
// confirmado ao vivo, então mostramos tudo que vier (mesmo motivo de
// dadosBrutos no schema.prisma). `formatar` permite ao processo administrativo
// usar a própria regra de valor (ver valorCelulaProcesso em processos.ts); sem
// ele, as entidades só com id são resolvidas pelo próprio registro.
export function preencherPlanilhaCamposDinamicos(
  planilha: ExcelJS.Worksheet,
  raw: Record<string, unknown>,
  formatar?: (chave: string, valor: unknown) => string | number,
) {
  if (!formatar) {
    const contexto = { entidades: indexarEntidades(raw) };
    formatar = (chave, valor) => valorCelulaDinamica(chave, valor, contexto);
  }
  const aplicarFormato = formatar;
  preencherPlanilhaCampos(
    planilha,
    Object.entries(raw).flatMap(([chave, valor]) => {
      const linha = { campo: formatarChave(chave), valor: aplicarFormato(chave, valor) };
      const codigo = ehChaveOrganograma(chave) ? codigoOrganograma(valor) : '';
      return codigo ? [linha, { campo: 'Código do organograma', valor: codigo }] : [linha];
    }),
  );
}

// Planilha com nome, tipo (fiscal/gestor) e período de vigência de cada
// responsável — ver extrairResponsavel acima.
function preencherPlanilhaResponsaveis(planilha: ExcelJS.Worksheet, responsaveis: Array<{ dadosBrutos: unknown }>) {
  planilha.columns = [
    { header: 'Responsável', key: 'responsavel', width: 36 },
    { header: 'Tipo', key: 'tipo', width: 20 },
    { header: 'Período', key: 'periodo', width: 28 },
  ];
  planilha.getRow(1).font = { bold: true };

  for (const { dadosBrutos } of responsaveis) {
    const { nome, tipo, periodo } = extrairResponsavel((dadosBrutos ?? {}) as Record<string, unknown>);
    planilha.addRow({ responsavel: nome ?? '', tipo: tipo ?? '', periodo: periodo ?? '' });
  }
}

// Um workbook por documento (contrato / aditivo / solicitação de
// fornecimento) — pedido do usuário: relatórios separados por documento, não
// um único arquivo juntando tudo (mesmo princípio do relatório em PDF da
// extensão, ver browser-extension/src/shared/pdf-relatorio.js).
function workbookContrato(contrato: NonNullable<Awaited<ReturnType<typeof buscarContrato>>>): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet('Contrato');
  preencherPlanilhaCampos(
    planilha,
    CAMPOS_RELATORIO.map((campo) => ({ campo: campo.label, valor: campo.valor(contrato) })),
  );

  if (contrato.itens.length > 0) {
    const planilhaItens = workbook.addWorksheet('Itens do Contrato');
    preencherPlanilhaItens(
      planilhaItens,
      null,
      contrato.itens.map((item) => ({ __fixo: String(item.ordem), raw: item.dadosBrutos as Record<string, unknown> })),
    );
  }

  if (contrato.responsaveis.length > 0) {
    const planilhaResponsaveis = workbook.addWorksheet('Responsáveis');
    preencherPlanilhaResponsaveis(planilhaResponsaveis, contrato.responsaveis);
  }

  return workbook;
}

// Documento próprio só com os responsáveis do contrato — separado do
// workbook do contrato (que mantém a aba "Responsáveis"), mesmo princípio dos
// demais documentos (um assunto por arquivo).
// Sem responsáveis, a aba sai com o aviso (mesmo texto da extensão,
// MENSAGEM_SEM_RESPONSAVEIS em campos-relatorio.js) — pedido do usuário,
// 2026-10-19: o documento é gerado sempre.
function workbookResponsaveis(responsaveis: Array<{ dadosBrutos: unknown }>): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet('Responsáveis');
  preencherPlanilhaResponsaveis(planilha, responsaveis);
  if (responsaveis.length === 0) {
    planilha.addRow({ responsavel: 'O contrato não tem responsáveis cadastrados' });
  }
  return workbook;
}

function workbookAditivo(aditivo: NonNullable<Awaited<ReturnType<typeof buscarContrato>>>['aditivos'][number]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet('Aditivo');
  preencherPlanilhaCamposDinamicos(planilha, aditivo.dadosBrutos as Record<string, unknown>);

  if (aditivo.itens.length > 0) {
    const planilhaItens = workbook.addWorksheet('Itens');
    preencherPlanilhaItens(
      planilhaItens,
      null,
      aditivo.itens.map((item) => ({ __fixo: String(item.ordem), raw: item.dadosBrutos as Record<string, unknown> })),
    );
  }

  return workbook;
}

function workbookApostilamento(
  apostilamento: NonNullable<Awaited<ReturnType<typeof buscarContrato>>>['apostilamentos'][number],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet('Apostilamento');
  // `itens` (quando o registro trouxer) vira aba própria, como no aditivo; o
  // restante dos campos fica na planilha campo/valor.
  const { itens, ...demaisCampos } = (apostilamento.dadosBrutos ?? {}) as Record<string, unknown>;
  preencherPlanilhaCamposDinamicos(planilha, demaisCampos);
  if (Array.isArray(itens) && itens.length > 0) {
    preencherPlanilhaItens(
      workbook.addWorksheet('Itens'),
      null,
      (itens as Record<string, unknown>[]).map((raw, i) => ({ __fixo: String(i + 1), raw })),
    );
  }
  return workbook;
}

function workbookSolicitacaoFornecimento(
  solicitacao: NonNullable<Awaited<ReturnType<typeof buscarContrato>>>['solicitacoesFornecimento'][number],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet('Solicitação de Fornecimento');
  preencherPlanilhaCamposDinamicos(planilha, solicitacao.dadosBrutos as Record<string, unknown>);

  // Itens vinculados à solicitação — aba própria, mesmo princípio de
  // workbookAditivo (aba "Aditivo" + aba "Itens").
  if (solicitacao.itens.length > 0) {
    preencherPlanilhaItens(
      workbook.addWorksheet('Itens'),
      null,
      solicitacao.itens.map((item) => ({ __fixo: String(item.ordem), raw: item.dadosBrutos as Record<string, unknown> })),
    );
  }
  return workbook;
}

function workbookInteracaoContabilidade(
  interacao: NonNullable<Awaited<ReturnType<typeof buscarContrato>>>['interacoesContabilidade'][number],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet('Interação Contábil');
  const raw = interacao.dadosBrutos as Record<string, unknown>;
  // `contratacao` vira "Sequencial da contratação" — só o sequencial (injetado
  // pela extensão, ver enriquecerSequenciaisContratacao em popup.js), não o
  // objeto cru com flags/id interno que o Betha devolve. Logo após
  // "Desdobramento" entra a linha "Despesa" (número da despesa de cada
  // rateio), igual ao PDF da extensão.
  const contexto = { entidades: indexarEntidades(raw) };
  preencherPlanilhaCampos(
    planilha,
    Object.entries(raw).flatMap(([chave, valor]) => {
      if (chave === 'contratacao') {
        const sequencial =
          valor != null && typeof valor === 'object' ? (valor as Record<string, unknown>).sequencial : null;
        return [{ campo: 'Sequencial da contratação', valor: sequencial != null ? String(sequencial) : '' }];
      }
      const linha = { campo: formatarChave(chave), valor: valorCelulaDinamica(chave, valor, contexto) };
      return chave === 'desdobramento'
        ? [
            linha,
            { campo: 'Despesa', valor: valorNumeroDespesa(valor) },
            { campo: 'Número/ano do empenho', valor: valorNumeroEmpenho(raw) },
          ]
        : [linha];
    }),
  );
  return workbook;
}

// Documento próprio com os recebimentos de UMA solicitação de fornecimento —
// separado do workbook da solicitação em si (pedido do usuário, 2026-09-17:
// "deixe os recebimentos separados em uma aba específica"). CADA recebimento
// vira sua PRÓPRIA aba (worksheet) dentro deste workbook, com todos os
// campos que a API devolveu — não colunas fixas: a tela "Editando
// recebimento" do Betha tem bem mais informação que a listagem (desconto,
// retenção tributária, provisório, observações, comprovantes), e um recorte
// fixo perderia esses campos quando vierem preenchidos. Quando o recebimento
// tem itens (o que efetivamente foi recebido do catálogo — pedido do
// usuário, 2026-09-17), ganha mais uma aba própria "Recebimento N - Itens",
// mesmo princípio de workbookAditivo (aba "Aditivo" + aba "Itens"). Nome de
// aba truncado em 31 caracteres (limite do Excel para nome de worksheet).
function workbookRecebimentos(
  solicitacao: NonNullable<Awaited<ReturnType<typeof buscarContrato>>>['solicitacoesFornecimento'][number],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  solicitacao.recebimentos.forEach((recebimento, index) => {
    const raw = (recebimento.dadosBrutos ?? {}) as Record<string, unknown>;
    const numero = raw.numero != null ? String(raw.numero) : String(index + 1);
    const planilha = workbook.addWorksheet(`Recebimento ${numero}`.slice(0, 31));
    preencherPlanilhaCamposDinamicos(planilha, raw);

    if (recebimento.itens.length > 0) {
      const planilhaItens = workbook.addWorksheet(`Recebimento ${numero} - Itens`.slice(0, 31));
      preencherPlanilhaItens(
        planilhaItens,
        null,
        recebimento.itens.map((item) => ({ __fixo: String(item.ordem), raw: item.dadosBrutos as Record<string, unknown> })),
      );
    }
  });
  return workbook;
}

// Descrição de cada documento gerado (contrato/aditivo/solicitação) —
// pedido do usuário: "contrato 12/2026", "aditivo 1", "solicitação de
// fornecimento 197/2026" (sem a palavra "relatório"). Usada como nome do
// arquivo dentro do zip — mesmo padrão do PDF gerado pela extensão (ver
// browser-extension/src/shared/campos-relatorio.js).
function tituloContrato(contrato: { numeroFormatado: string | null; sequencial: number }): string {
  const numero = contrato.numeroFormatado ?? `seq. ${contrato.sequencial}`;
  return `contrato ${numero}`;
}

// "publicação contrato 12/2026" — mesmo título do PDF da extensão
// (tituloPublicacoes em browser-extension/src/shared/campos-relatorio.js).
function tituloPublicacoes(contrato: { numeroFormatado: string | null; sequencial: number }): string {
  return `publicação ${tituloContrato(contrato)}`;
}

// Documento "publicação contrato X": uma aba por publicação, com todos os
// campos que a API devolveu (mesmo princípio de workbookRecebimentos). Sem
// publicação, uma aba única com o aviso — o documento sai sempre, um por
// contratação (pedido do usuário, 2026-10-19).
function workbookPublicacoes(publicacoes: Array<{ dadosBrutos: unknown }>): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  if (publicacoes.length === 0) {
    preencherPlanilhaCampos(workbook.addWorksheet('Publicações'), [
      { campo: 'Publicações', valor: 'Sem publicações cadastradas' },
    ]);
    return workbook;
  }
  publicacoes.forEach((publicacao, index) => {
    preencherPlanilhaCamposDinamicos(
      workbook.addWorksheet(`Publicação ${index + 1}`.slice(0, 31)),
      (publicacao.dadosBrutos ?? {}) as Record<string, unknown>,
    );
  });
  return workbook;
}

// "textos contrato 12/2026" — mesmo título do PDF da extensão (tituloTextos em
// browser-extension/src/shared/campos-relatorio.js).
function tituloTextos(contrato: { numeroFormatado: string | null; sequencial: number }): string {
  return `textos ${tituloContrato(contrato)}`;
}

const MENSAGEM_SEM_TEXTOS = 'Sem textos cadastrados';

// "texto 1 — Termo de Referência": o `titulo` do próprio texto, quando houver.
function tituloBlocoTexto(raw: Record<string, unknown>, index: number): string {
  const titulo = typeof raw.titulo === 'string' ? raw.titulo.trim() : '';
  return titulo ? `texto ${index + 1} — ${titulo}` : `texto ${index + 1}`;
}

// Nome da aba de um texto: "Texto 1 - Termo de Referência", sem os
// caracteres que o Excel não aceita em nome de aba e no limite de 31.
function nomeAbaTexto(raw: Record<string, unknown>, index: number): string {
  const nome = tituloBlocoTexto(raw, index).replace('—', '-').replace(/[\\/?*[\]:']/g, ' ');
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}`.slice(0, 31).trim();
}

// `conteudo` do texto vem do editor do Betha — pode ser HTML. Na planilha
// vira texto corrido, uma linha por parágrafo, sem as tags. Mesma lógica do
// lado da extensão (conteudoTexto em browser-extension/src/shared/campos-relatorio.js).
function conteudoTexto(valor: unknown): string | number {
  if (typeof valor !== 'string') return valorCelula(valor);
  if (!/<[a-z!/][^>]*>/i.test(valor)) return valor;
  const entidades: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return valor
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (original, codigo: string) => {
      if (codigo[0] === '#') {
        const n = codigo[1].toLowerCase() === 'x' ? parseInt(codigo.slice(2), 16) : parseInt(codigo.slice(1), 10);
        return Number.isNaN(n) || n > 0x10ffff ? original : String.fromCodePoint(n);
      }
      return entidades[codigo.toLowerCase()] ?? original;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Documento "textos contrato X": uma aba por texto da rotina "Textos", com
// todos os campos que a API devolveu (mesmo princípio de workbookPublicacoes).
// Sem textos, uma aba única com o aviso — sai sempre, um por contratação
// (pedido do usuário, 2026-10-21). Também usado pelos textos do processo
// administrativo, que passam a própria regra de valor em `formatar` (ver
// valorCelulaProcesso em processos.ts); `conteudo` é sempre convertido aqui.
export function workbookTextos(
  textos: Array<{ dadosBrutos: unknown }>,
  formatar?: (raw: Record<string, unknown>, chave: string, valor: unknown) => string | number,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  if (textos.length === 0) {
    preencherPlanilhaCampos(workbook.addWorksheet('Textos'), [{ campo: 'Textos', valor: MENSAGEM_SEM_TEXTOS }]);
    return workbook;
  }
  textos.forEach((texto, index) => {
    const raw = (texto.dadosBrutos ?? {}) as Record<string, unknown>;
    const contexto = { entidades: indexarEntidades(raw) };
    const valorDoCampo = formatar
      ? (chave: string, valor: unknown) => formatar(raw, chave, valor)
      : (chave: string, valor: unknown) => valorCelulaDinamica(chave, valor, contexto);
    preencherPlanilhaCamposDinamicos(workbook.addWorksheet(nomeAbaTexto(raw, index)), raw, (chave, valor) =>
      chave === 'conteudo' ? conteudoTexto(valor) : valorDoCampo(chave, valor),
    );
  });
  return workbook;
}

function tituloResponsaveis(contrato: { numeroFormatado: string | null; sequencial: number }): string {
  return `responsáveis do ${tituloContrato(contrato)}`;
}

function tituloAditivo(aditivo: { sequencial: number | null; ordem: number }): string {
  return `aditivo ${aditivo.sequencial ?? aditivo.ordem}`;
}

function tituloApostilamento(apostilamento: { sequencial: number | null; ordem: number }): string {
  return `apostilamento ${apostilamento.sequencial ?? apostilamento.ordem}`;
}

function tituloSolicitacaoFornecimento(solicitacao: { ordem: number; dadosBrutos: unknown }): string {
  const raw = (solicitacao.dadosBrutos ?? {}) as Record<string, unknown>;
  const numero = (raw.numeroAno as string | undefined) ?? (raw.numero != null ? String(raw.numero) : undefined);
  return `solicitação de fornecimento ${numero ?? solicitacao.ordem}`;
}

// Sem um "número/ano" formatado como o de solicitação de fornecimento — usa
// `sequencial` (posição da interação dentro do contrato) + o tipo de ação
// (Empenhar/Liquidar/Pagar) pra identificar cada uma, mesma lógica do lado
// da extensão de navegador (browser-extension/src/shared/campos-relatorio.js).
function tituloInteracaoContabilidade(interacao: { ordem: number; dadosBrutos: unknown }): string {
  const raw = (interacao.dadosBrutos ?? {}) as Record<string, unknown>;
  const identificador = raw.sequencial != null ? String(raw.sequencial) : String(interacao.ordem);
  const tipoAcao = (raw.tipoAcaoDesc as string | undefined) ?? (raw.tipoAcao as string | undefined);
  return `interação contábil ${identificador}${tipoAcao ? ` (${tipoAcao})` : ''}`;
}

function tituloRecebimentos(solicitacao: { ordem: number; dadosBrutos: unknown }): string {
  return `recebimentos da ${tituloSolicitacaoFornecimento(solicitacao)}`;
}

// Nome de arquivo a partir da descrição do documento (ex.: "aditivo 1" ->
// "aditivo-1") — sem acento, minúsculo, só letras/números separados por
// hífen.
export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// exceljs declara um `Buffer` próprio no seu .d.ts (interface local mínima,
// `extends ArrayBuffer` — suporte a browser, onde não existe o Buffer do
// Node), sem relação com o Buffer real do Node que `writeBuffer()` devolve
// em runtime. Isola o cast num só lugar em vez de repetir `as unknown as
// Buffer` a cada chamada.
export async function workbookParaBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

contratosRouter.get('/:id/relatorio', async (req, res) => {
  const contrato = await buscarContrato(req.params.id);
  if (!contrato) {
    res.status(404).json({ error: 'Contrato não encontrado' });
    return;
  }

  const nomeContrato = slug(tituloContrato(contrato));
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeContrato}.zip"`);

  const arquivoZip = archiver('zip', { zlib: { level: 9 } });
  // Erro no meio da escrita do zip (ex.: stream do cliente fechada) não pode
  // virar exceção não tratada — derruba a resposta em vez de crashar o
  // processo (padrão recomendado pelo archiver para servidores long-running).
  arquivoZip.on('error', (err) => res.destroy(err));
  arquivoZip.pipe(res);

  arquivoZip.append(await workbookParaBuffer(workbookContrato(contrato)), { name: `${nomeContrato}.xlsx` });

  // Sempre gerado, mesmo sem responsáveis (aí sai com o aviso).
  arquivoZip.append(await workbookParaBuffer(workbookResponsaveis(contrato.responsaveis)), {
    name: `${slug(tituloResponsaveis(contrato))}.xlsx`,
  });

  for (const aditivo of contrato.aditivos) {
    const buffer = await workbookParaBuffer(workbookAditivo(aditivo));
    arquivoZip.append(buffer, { name: `${slug(tituloAditivo(aditivo))}.xlsx` });
  }

  for (const apostilamento of contrato.apostilamentos) {
    const buffer = await workbookParaBuffer(workbookApostilamento(apostilamento));
    arquivoZip.append(buffer, { name: `${slug(tituloApostilamento(apostilamento))}.xlsx` });
  }

  for (const solicitacao of contrato.solicitacoesFornecimento) {
    const buffer = await workbookParaBuffer(workbookSolicitacaoFornecimento(solicitacao));
    arquivoZip.append(buffer, { name: `${slug(tituloSolicitacaoFornecimento(solicitacao))}.xlsx` });
  }

  for (const interacao of contrato.interacoesContabilidade) {
    const buffer = await workbookParaBuffer(workbookInteracaoContabilidade(interacao));
    arquivoZip.append(buffer, { name: `${slug(tituloInteracaoContabilidade(interacao))}.xlsx` });
  }

  for (const solicitacao of contrato.solicitacoesFornecimento) {
    if (solicitacao.recebimentos.length === 0) continue;
    const buffer = await workbookParaBuffer(workbookRecebimentos(solicitacao));
    arquivoZip.append(buffer, { name: `${slug(tituloRecebimentos(solicitacao))}.xlsx` });
  }

  arquivoZip.append(await workbookParaBuffer(workbookPublicacoes(contrato.publicacoes)), {
    name: `${slug(tituloPublicacoes(contrato))}.xlsx`,
  });

  // Entidades só com id resolvidas pelo contrato inteiro (igual ao PDF).
  const entidadesContrato = indexarEntidades([contrato.dadosBrutos, ...contrato.textos.map((t) => t.dadosBrutos)]);
  const textosXlsx = workbookTextos(contrato.textos, (_raw, chave, valor) =>
    valorCelulaDinamica(chave, valor, { entidades: entidadesContrato }),
  );
  arquivoZip.append(await workbookParaBuffer(textosXlsx), {
    name: `${slug(tituloTextos(contrato))}.xlsx`,
  });

  await arquivoZip.finalize();
});
