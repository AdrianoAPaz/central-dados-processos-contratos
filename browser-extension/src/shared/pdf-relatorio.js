// Gera o relatório da tela (report.js) como PDFs de verdade — um por
// documento (contrato, cada aditivo, cada solicitação de fornecimento), pra
// empacotar junto com os anexos no zip (pedido do usuário: relatórios
// separados por documento). `window.print()` não devolve bytes, só abre o
// diálogo nativo do navegador, por isso não dá pra usá-lo aqui. Usa jsPDF +
// jspdf-autotable vendorizados em `src/vendor/` (ver README ali sobre por
// que são UMD e não ESM).
import {
  montarCamposRelatorio,
  montarSecoesAditivos,
  montarTabelaItens,
  montarTabelaResponsaveis,
  montarSecoesSolicitacoesFornecimento,
  montarSecoesInteracoesContabilidade,
  montarSecoesRecebimentos,
  montarDocumentoPublicacoes,
  tituloContrato,
  MENSAGEM_SEM_RESPONSAVEIS,
} from './campos-relatorio.js'

const MARGEM = 40
const SUBTITULO_PADRAO = 'Central de Dados de Processos e Contratos'

function obterJsPDF() {
  const ns = window.jspdf
  if (!ns || !ns.jsPDF) {
    throw new Error('jsPDF não carregado — confira os <script> de src/vendor/ em report.html.')
  }
  return ns.jsPDF
}

// Insere página nova se o próximo bloco não couber no espaço restante —
// sem isto, um título ou tabela pequena podia nascer colada no fim da
// página e "flutuar" sozinha na próxima, sem relação visual com o que vem
// depois.
export function garantirEspaco(doc, cursor, alturaMinima) {
  const alturaPagina = doc.internal.pageSize.getHeight()
  if (cursor + alturaMinima > alturaPagina - MARGEM) {
    doc.addPage()
    return MARGEM
  }
  return cursor
}

export function desenharTitulo(doc, cursor, texto, tamanhoFonte) {
  cursor = garantirEspaco(doc, cursor, tamanhoFonte + 10)
  doc.setFontSize(tamanhoFonte)
  doc.setFont('helvetica', 'bold')
  doc.text(texto, MARGEM, cursor)
  doc.setFont('helvetica', 'normal')
  return cursor + tamanhoFonte + 6
}

// Tabela de 2 colunas (label/valor) — mesmo formato da tabela de campos do
// contrato/aditivo/solicitação na tela.
export function desenharTabelaCampos(doc, cursor, campos) {
  doc.autoTable({
    startY: cursor,
    margin: { left: MARGEM, right: MARGEM },
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 160 } },
    body: campos.map((c) => [c.label, c.valor || '—']),
  })
  return doc.lastAutoTable.finalY + 12
}

// Tabela de colunas dinâmicas (itens do contrato ou de um aditivo).
export function desenharTabelaDinamica(doc, cursor, { colunas, linhas }) {
  if (!linhas.length) return cursor
  doc.autoTable({
    startY: cursor,
    margin: { left: MARGEM, right: MARGEM },
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3 },
    head: [colunas],
    body: linhas.map((linha) => linha.map((v) => v || '—')),
  })
  return doc.lastAutoTable.finalY + 12
}

// Cria um documento novo com o cabeçalho padrão (título do documento +
// subtítulo institucional) — cada relatório (contrato/aditivo/solicitação) é
// um jsPDF próprio, nunca compartilhado com os demais.
export function novoDocumento(titulo) {
  const jsPDF = obterJsPDF()
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let cursor = MARGEM

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(titulo, MARGEM, cursor)
  cursor += 18
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(SUBTITULO_PADRAO, MARGEM, cursor)
  cursor += 22

  return { doc, cursor }
}

// PDF com os dados do contrato + itens do contrato — sem aditivos nem
// solicitações de fornecimento (cada um vira o seu próprio documento).
export function gerarPdfContrato(contrato) {
  const { doc, cursor: inicio } = novoDocumento(tituloContrato(contrato))
  let cursor = desenharTabelaCampos(doc, inicio, montarCamposRelatorio(contrato))

  const tabelaItens = montarTabelaItens(contrato.itens)
  if (tabelaItens.linhas.length) {
    cursor = desenharTitulo(doc, cursor, `Itens do contrato (${contrato.itens.length})`, 13)
    cursor = desenharTabelaDinamica(doc, cursor, tabelaItens)
  }

  const tabelaResponsaveis = montarTabelaResponsaveis(contrato.responsaveis)
  if (tabelaResponsaveis.linhas.length) {
    cursor = desenharTitulo(doc, cursor, `Responsáveis (${contrato.responsaveis.length})`, 13)
    desenharTabelaDinamica(doc, cursor, tabelaResponsaveis)
  }

  return doc.output('blob')
}

// PDF só com os responsáveis do contrato (fiscal, gestor etc.): nome, tipo e
// período de cada um. A seção também continua no PDF do contrato.
// Gerado sempre (pedido do usuário, 2026-10-19): sem responsáveis, o
// documento sai com o aviso em vez da tabela.
export function gerarPdfResponsaveis(contrato) {
  const { doc, cursor } = novoDocumento(tituloResponsaveis(contrato))
  const tabela = montarTabelaResponsaveis(contrato.responsaveis)
  if (tabela.linhas.length) {
    desenharTabelaDinamica(doc, cursor, tabela)
  } else {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.text(MENSAGEM_SEM_RESPONSAVEIS, MARGEM, cursor)
    doc.setFont('helvetica', 'normal')
  }
  return doc.output('blob')
}

function tituloResponsaveis(contrato) {
  return `responsáveis do ${tituloContrato(contrato)}`
}

// PDF de UM aditivo (campos + itens vinculados a ele) — `secao` é uma
// entrada de montarSecoesAditivos.
export function gerarPdfAditivo(secao) {
  const { doc, cursor: inicio } = novoDocumento(secao.titulo)
  let cursor = desenharTabelaCampos(doc, inicio, secao.campos)

  if (secao.tabelaItens.linhas.length) {
    cursor = desenharTitulo(doc, cursor, 'Itens', 13)
    desenharTabelaDinamica(doc, cursor, secao.tabelaItens)
  } else {
    cursor = garantirEspaco(doc, cursor, 16)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.text('Sem itens vinculados', MARGEM, cursor)
    doc.setFont('helvetica', 'normal')
  }

  return doc.output('blob')
}

// PDF de UMA solicitação de fornecimento (todos os campos que a API
// devolveu + itens vinculados a ela) — `secao` é uma entrada de
// montarSecoesSolicitacoesFornecimento. Mesmo estilo de gerarPdfAditivo.
export function gerarPdfSolicitacaoFornecimento(secao) {
  return gerarPdfAditivo(secao)
}

// PDF de UMA interação contábil (todos os campos que a API devolveu) —
// `secao` é uma entrada de montarSecoesInteracoesContabilidade.
export function gerarPdfInteracaoContabilidade(secao) {
  const { doc, cursor: inicio } = novoDocumento(secao.titulo)
  desenharTabelaCampos(doc, inicio, secao.campos)
  return doc.output('blob')
}

// PDF com os recebimentos de UMA solicitação de fornecimento — documento
// próprio, separado do PDF da solicitação em si (pedido do usuário,
// 2026-09-17). Cada recebimento é um bloco com TODOS os campos que a API
// devolveu (não uma tabela de colunas fixas — a tela "Editando recebimento"
// do Betha tem bem mais informação que a listagem: desconto, retenção
// tributária, provisório, observações, comprovantes). `secao` é uma entrada
// de montarSecoesRecebimentos. Logo abaixo dos campos de cada recebimento,
// os itens efetivamente recebidos (pedido do usuário, 2026-09-17) — mesmo
// estilo campos+itens de gerarPdfAditivo.
export function gerarPdfRecebimentos(secao) {
  const { doc, cursor: inicioDoc } = novoDocumento(secao.titulo)
  let cursor = inicioDoc
  for (const recebimento of secao.recebimentos) {
    cursor = desenharTitulo(doc, cursor, recebimento.titulo, 12)
    cursor = desenharTabelaCampos(doc, cursor, recebimento.campos)

    if (recebimento.tabelaItens.linhas.length) {
      cursor = desenharTitulo(doc, cursor, 'Itens', 11)
      cursor = desenharTabelaDinamica(doc, cursor, recebimento.tabelaItens)
    } else {
      cursor = garantirEspaco(doc, cursor, 16)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'italic')
      doc.text('Sem itens vinculados', MARGEM, cursor)
      doc.setFont('helvetica', 'normal')
      cursor += 20
    }
  }
  return doc.output('blob')
}

// PDF "publicação contrato X" — um bloco por publicação com todos os campos,
// ou o aviso de que não há nenhuma. `documento` é o retorno de
// montarDocumentoPublicacoes.
export function gerarPdfPublicacoes(documento) {
  const { doc, cursor: inicioDoc } = novoDocumento(documento.titulo)
  let cursor = inicioDoc
  if (!documento.blocos.length) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.text('Sem publicações cadastradas', MARGEM, cursor)
    doc.setFont('helvetica', 'normal')
  }
  for (const bloco of documento.blocos) {
    cursor = desenharTitulo(doc, cursor, bloco.titulo, 12)
    cursor = desenharTabelaCampos(doc, cursor, bloco.campos)
  }
  return doc.output('blob')
}

// Nome de arquivo a partir da descrição do documento (ex.: "aditivo 1" ->
// "aditivo-1") — sem acento, minúsculo, só letras/números separados por
// hífen.
export function slug(texto) {
  return texto
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// Lista os documentos a gerar pro relatório completo — um por contrato, um
// só dos responsáveis, um por aditivo, um por solicitação de fornecimento — sem gerar os bytes ainda
// (`gerar` é preguiçoso, pra quem consome poder tratar erro de um documento
// sem derrubar os demais). Nome do arquivo é a própria descrição do
// documento (ex.: "aditivo 1" -> "aditivo-1.pdf").
export function listarDocumentosRelatorio(contrato) {
  const documentos = [{ nome: `${slug(tituloContrato(contrato))}.pdf`, gerar: () => gerarPdfContrato(contrato) }]

  // Sempre gerado, mesmo sem responsáveis (aí sai com o aviso).
  documentos.push({ nome: `${slug(tituloResponsaveis(contrato))}.pdf`, gerar: () => gerarPdfResponsaveis(contrato) })

  for (const secao of montarSecoesAditivos(contrato.aditivos)) {
    documentos.push({ nome: `${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfAditivo(secao) })
  }

  for (const secao of montarSecoesSolicitacoesFornecimento(contrato.solicitacoesFornecimento)) {
    documentos.push({ nome: `${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfSolicitacaoFornecimento(secao) })
  }

  for (const secao of montarSecoesInteracoesContabilidade(contrato.interacoesContabilidade)) {
    documentos.push({ nome: `${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfInteracaoContabilidade(secao) })
  }

  for (const secao of montarSecoesRecebimentos(contrato.solicitacoesFornecimento)) {
    documentos.push({ nome: `${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfRecebimentos(secao) })
  }

  // Sempre gerado, mesmo sem publicação (pedido do usuário: um por contratação).
  const publicacoes = montarDocumentoPublicacoes(contrato)
  documentos.push({ nome: `${slug(publicacoes.titulo)}.pdf`, gerar: () => gerarPdfPublicacoes(publicacoes) })

  return documentos
}
