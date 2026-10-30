// Gera o relatório da tela (report.js) como PDFs de verdade — um por
// documento (contrato, cada aditivo, cada apostilamento, cada solicitação de fornecimento), pra
// empacotar junto com os anexos no zip (pedido do usuário: relatórios
// separados por documento). `window.print()` não devolve bytes, só abre o
// diálogo nativo do navegador, por isso não dá pra usá-lo aqui. Usa jsPDF +
// jspdf-autotable vendorizados em `src/vendor/` (ver README ali sobre por
// que são UMD e não ESM).
import { formatarTitulo } from './titulo.js'
import {
  montarCamposRelatorio,
  montarSecoesAditivos,
  montarSecoesApostilamentos,
  montarSecoesRescisoes,
  montarSecoesSuspensoes,
  montarSecoesOutrasAlteracoes,
  montarDocumentoDespesas,
  montarTabelaItens,
  montarTabelaHistoricoAnexos,
  montarTabelaResponsaveis,
  montarSecoesSolicitacoesFornecimento,
  montarSecoesInteracoesContabilidade,
  montarSecoesRecebimentos,
  montarDocumentoPublicacoes,
  montarDocumentoTextos,
  tituloContrato,
  MENSAGEM_SEM_RESPONSAVEIS,
  MENSAGEM_SEM_TEXTOS,
  MENSAGEM_SEM_DESPESAS,
} from './campos-relatorio.js'

const MARGEM = 40
// Serifada (Times), padrão de documento administrativo/de auditoria.
const FONTE = 'times'
const SUBTITULO_PADRAO = 'Central de Dados de Processos e Contratos'

// Estilo sóbrio, pensado pra leitura/conferência de auditoria: paleta neutra
// (cinzas), linhas finas, hierarquia título > seção > tabela, cabeçalho de
// tabela repetido a cada página, linhas que não se partem entre páginas,
// colunas numéricas à direita e rodapé com paginação. Só apresentação —
// nenhum dado é alterado. Vale pra todos os PDFs (contratos e processos).
const COR_TEXTO = [34, 34, 34]
const COR_TEXTO_SUAVE = [100, 100, 100]
const COR_LINHA = [200, 200, 200]
const COR_FUNDO_ROTULO = [243, 243, 243]
const COR_FUNDO_CABECALHO = [229, 229, 229]
const COR_FUNDO_ZEBRA = [249, 249, 249]
const ESTILO_CELULA = {
  font: FONTE,
  textColor: COR_TEXTO,
  lineColor: COR_LINHA,
  lineWidth: 0.5,
  valign: 'top',
  overflow: 'linebreak',
}

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

// Título de seção (ou de bloco/registro) com filete fino embaixo. A
// hierarquia é única, pra todas as seções ficarem iguais.
export function desenharTitulo(doc, cursor, texto) {
  // Título + ao menos o cabeçalho e uma linha da tabela juntos, pra não ficar
  // órfão no fim da página.
  cursor = garantirEspaco(doc, cursor, 60)
  const largura = doc.internal.pageSize.getWidth()
  doc.setFont(FONTE, 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...COR_TEXTO)
  doc.text(formatarTitulo(texto), MARGEM, cursor)
  doc.setDrawColor(...COR_LINHA)
  doc.setLineWidth(0.5)
  doc.line(MARGEM, cursor + 4, largura - MARGEM, cursor + 4)
  doc.setFont(FONTE, 'normal')
  return cursor + 12
}

// Mensagem em itálico cinza (ex.: "Sem itens vinculados").
export function desenharAviso(doc, cursor, texto, tamanhoFonte = 9) {
  cursor = garantirEspaco(doc, cursor, 20)
  doc.setFont(FONTE, 'italic')
  doc.setFontSize(tamanhoFonte)
  doc.setTextColor(...COR_TEXTO_SUAVE)
  doc.text(texto, MARGEM, cursor + 8)
  doc.setFont(FONTE, 'normal')
  doc.setTextColor(...COR_TEXTO)
  return cursor + 28
}

// Tabela de 2 colunas (label/valor) — mesmo formato da tabela de campos do
// contrato/aditivo/solicitação na tela.
export function desenharTabelaCampos(doc, cursor, campos) {
  doc.autoTable({
    startY: cursor,
    margin: { left: MARGEM, right: MARGEM, bottom: MARGEM + 10 },
    theme: 'grid',
    styles: { ...ESTILO_CELULA, fontSize: 10, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 } },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 150, fillColor: COR_FUNDO_ROTULO },
    },
    rowPageBreak: 'avoid',
    // 0 é valor de verdade (ex.: "Quantidade de aditivos"), não "sem dado".
    body: campos.map((c) => [c.label, c.valor === 0 ? '0' : c.valor || '—']),
  })
  return doc.lastAutoTable.finalY + 18
}

// Colunas em que todo valor preenchido parece número/moeda ficam alinhadas à
// direita, pra facilitar a comparação entre linhas.
const PADRAO_NUMERICO = /^(R\$\s*)?-?\d{1,3}(\.\d{3})*(,\d+)?%?$|^(R\$\s*)?-?\d+(,\d+)?%?$/

function colunasNumericas(colunas, linhas) {
  return colunas.map((_, i) => {
    const valores = linhas.map((l) => l[i]).filter((v) => v !== undefined && v !== null && v !== '')
    return valores.length > 0 && valores.every((v) => PADRAO_NUMERICO.test(String(v).trim()))
  })
}

// Tabela de colunas dinâmicas (itens do contrato ou de um aditivo).
export function desenharTabelaDinamica(doc, cursor, { colunas, linhas }) {
  if (!linhas.length) return cursor
  const columnStyles = {}
  colunasNumericas(colunas, linhas).forEach((ehNumerica, i) => {
    if (ehNumerica) columnStyles[i] = { halign: 'right' }
  })
  doc.autoTable({
    startY: cursor,
    margin: { left: MARGEM, right: MARGEM, bottom: MARGEM + 10 },
    theme: 'grid',
    styles: { ...ESTILO_CELULA, fontSize: 9, cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 } },
    headStyles: {
      fillColor: COR_FUNDO_CABECALHO,
      textColor: COR_TEXTO,
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: { fillColor: COR_FUNDO_ZEBRA },
    columnStyles,
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    head: [colunas],
    body: linhas.map((linha) => linha.map((v) => v || '—')),
  })
  return doc.lastAutoTable.finalY + 18
}

// Cria um documento novo com o cabeçalho padrão (título do documento +
// subtítulo institucional) — cada relatório (contrato/aditivo/solicitação) é
// um jsPDF próprio, nunca compartilhado com os demais. O título fica guardado
// no doc pra `finalizarDocumento` repetir no rodapé.
export function novoDocumento(titulo) {
  const jsPDF = obterJsPDF()
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const largura = doc.internal.pageSize.getWidth()
  let cursor = MARGEM
  titulo = formatarTitulo(titulo)
  doc.tituloRelatorio = titulo

  doc.setTextColor(...COR_TEXTO)
  doc.setFont(FONTE, 'bold')
  doc.setFontSize(16)
  doc.text(titulo, MARGEM, cursor)
  cursor += 16
  doc.setFont(FONTE, 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COR_TEXTO_SUAVE)
  doc.text(SUBTITULO_PADRAO, MARGEM, cursor)
  cursor += 8
  doc.setDrawColor(...COR_TEXTO_SUAVE)
  doc.setLineWidth(0.8)
  doc.line(MARGEM, cursor, largura - MARGEM, cursor)
  doc.setTextColor(...COR_TEXTO)
  return { doc, cursor: cursor + 16 }
}

// Fecha o documento: rodapé em todas as páginas (identificação e "Página X de
// Y", só possível agora que o total de páginas é conhecido) e devolve o blob.
export function finalizarDocumento(doc) {
  const total = doc.getNumberOfPages()
  const { width, height } = doc.internal.pageSize
  for (let pagina = 1; pagina <= total; pagina++) {
    doc.setPage(pagina)
    doc.setDrawColor(...COR_LINHA)
    doc.setLineWidth(0.5)
    doc.line(MARGEM, height - 32, width - MARGEM, height - 32)
    doc.setFont(FONTE, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COR_TEXTO_SUAVE)
    doc.text(`${SUBTITULO_PADRAO} — ${doc.tituloRelatorio}`, MARGEM, height - 20)
    doc.text(`Página ${pagina} de ${total}`, width - MARGEM, height - 20, { align: 'right' })
  }
  doc.setTextColor(...COR_TEXTO)
  return doc.output('blob')
}

// Seção "Anexados por" (quem anexou cada arquivo e quando) — nada se não
// houver anexo com autor/data. Devolve o cursor.
function desenharAnexadosPor(doc, cursor, tabela) {
  if (!tabela || !tabela.linhas.length) return cursor
  return desenharTabelaDinamica(doc, desenharTitulo(doc, cursor, 'Anexados por'), tabela)
}

// PDF com os dados do contrato + itens do contrato — sem aditivos nem
// solicitações de fornecimento (cada um vira o seu próprio documento).
export function gerarPdfContrato(contrato) {
  const { doc, cursor: inicio } = novoDocumento(tituloContrato(contrato))
  let cursor = desenharTabelaCampos(doc, inicio, montarCamposRelatorio(contrato))

  const tabelaItens = montarTabelaItens(contrato.itens)
  if (tabelaItens.linhas.length) {
    cursor = desenharTitulo(doc, cursor, `Itens do contrato (${contrato.itens.length})`)
    cursor = desenharTabelaDinamica(doc, cursor, tabelaItens)
  }

  cursor = desenharAnexadosPor(doc, cursor, montarTabelaHistoricoAnexos(contrato.arquivos))

  const tabelaResponsaveis = montarTabelaResponsaveis(contrato.responsaveis)
  if (tabelaResponsaveis.linhas.length) {
    cursor = desenharTitulo(doc, cursor, `Responsáveis (${contrato.responsaveis.length})`)
    desenharTabelaDinamica(doc, cursor, tabelaResponsaveis)
  }

  return finalizarDocumento(doc)
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
    desenharAviso(doc, cursor, MENSAGEM_SEM_RESPONSAVEIS)
  }
  return finalizarDocumento(doc)
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
    cursor = desenharTitulo(doc, cursor, 'Itens')
    cursor = desenharTabelaDinamica(doc, cursor, secao.tabelaItens)
  } else {
    cursor = desenharAviso(doc, cursor, 'Sem itens vinculados')
  }
  desenharAnexadosPor(doc, cursor, secao.tabelaHistoricoAnexos)

  return finalizarDocumento(doc)
}

// PDF de UM apostilamento (todos os campos que a API devolveu) — `secao` é
// uma entrada de montarSecoesApostilamentos. Apostilamento em geral não tem
// itens vinculados: a tabela só sai se o registro trouxer `itens`, sem o aviso
// "Sem itens vinculados" que o aditivo mostra.
export function gerarPdfApostilamento(secao) {
  const { doc, cursor: inicio } = novoDocumento(secao.titulo)
  let cursor = desenharTabelaCampos(doc, inicio, secao.campos)
  if (secao.tabelaItens.linhas.length) {
    cursor = desenharTabelaDinamica(doc, desenharTitulo(doc, cursor, 'Itens'), secao.tabelaItens)
  }
  desenharAnexadosPor(doc, cursor, secao.tabelaHistoricoAnexos)
  return finalizarDocumento(doc)
}

// PDF de UMA solicitação de fornecimento (todos os campos que a API
// devolveu + itens vinculados a ela) — `secao` é uma entrada de
// montarSecoesSolicitacoesFornecimento. Mesmo estilo de gerarPdfAditivo.
export function gerarPdfSolicitacaoFornecimento(secao) {
  const { doc, cursor: inicio } = novoDocumento(secao.titulo)
  let cursor = desenharTabelaCampos(doc, inicio, secao.campos)

  cursor = desenharTitulo(doc, cursor, 'Itens')
  if (secao.tabelaItens.linhas.length) {
    cursor = desenharTabelaDinamica(doc, cursor, secao.tabelaItens)
  } else {
    cursor = desenharAviso(doc, cursor, 'Sem itens vinculados')
  }

  // Trilha de auditoria: quem registrou cada situação e quando.
  if (secao.tabelaHistorico.linhas.length) {
    cursor = desenharTitulo(doc, cursor, 'Histórico')
    desenharTabelaDinamica(doc, cursor, secao.tabelaHistorico)
  }
  return finalizarDocumento(doc)
}

// PDF de UMA interação contábil (todos os campos que a API devolveu) —
// `secao` é uma entrada de montarSecoesInteracoesContabilidade.
export function gerarPdfInteracaoContabilidade(secao) {
  const { doc, cursor: inicio } = novoDocumento(secao.titulo)
  const cursor = desenharTabelaCampos(doc, inicio, secao.campos)
  // Trilha de auditoria: quem registrou cada situação e quando.
  if (secao.tabelaHistorico.linhas.length) {
    desenharTabelaDinamica(doc, desenharTitulo(doc, cursor, 'Histórico'), secao.tabelaHistorico)
  }
  return finalizarDocumento(doc)
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
    cursor = desenharTitulo(doc, cursor, recebimento.titulo)
    cursor = desenharTabelaCampos(doc, cursor, recebimento.campos)

    if (recebimento.tabelaItens.linhas.length) {
      cursor = desenharTitulo(doc, cursor, 'Itens')
      cursor = desenharTabelaDinamica(doc, cursor, recebimento.tabelaItens)
    } else {
      cursor = desenharAviso(doc, cursor, 'Sem itens vinculados')
    }
  }
  return finalizarDocumento(doc)
}

// PDF "publicação contrato X" — um bloco por publicação com todos os campos,
// ou o aviso de que não há nenhuma. `documento` é o retorno de
// montarDocumentoPublicacoes.
export function gerarPdfPublicacoes(documento) {
  const { doc, cursor: inicioDoc } = novoDocumento(documento.titulo)
  let cursor = inicioDoc
  if (!documento.blocos.length) {
    cursor = desenharAviso(doc, cursor, 'Sem publicações cadastradas')
  }
  for (const bloco of documento.blocos) {
    cursor = desenharTitulo(doc, cursor, bloco.titulo)
    cursor = desenharTabelaCampos(doc, cursor, bloco.campos)
    cursor = desenharAnexadosPor(doc, cursor, bloco.tabelaHistoricoAnexos)
  }
  return finalizarDocumento(doc)
}

// PDF "despesas contrato X" — um bloco por despesa vinculada com todos os
// campos, ou o aviso de que não há nenhuma. `documento` é o retorno de
// montarDocumentoDespesas.
export function gerarPdfDespesas(documento) {
  const { doc, cursor: inicioDoc } = novoDocumento(documento.titulo)
  let cursor = inicioDoc
  if (!documento.blocos.length) {
    cursor = desenharAviso(doc, cursor, MENSAGEM_SEM_DESPESAS)
  }
  for (const bloco of documento.blocos) {
    cursor = desenharTitulo(doc, cursor, bloco.titulo)
    cursor = desenharTabelaCampos(doc, cursor, bloco.campos)
  }
  return finalizarDocumento(doc)
}

// PDF "textos contrato X" — um bloco por texto da rotina "Textos" com todos
// os campos, ou o aviso de que não há nenhum. `documento` é o retorno de
// montarDocumentoTextos.
export function gerarPdfTextos(documento) {
  const { doc, cursor: inicioDoc } = novoDocumento(documento.titulo)
  let cursor = inicioDoc
  if (!documento.blocos.length) {
    cursor = desenharAviso(doc, cursor, MENSAGEM_SEM_TEXTOS)
  }
  for (const bloco of documento.blocos) {
    cursor = desenharTitulo(doc, cursor, bloco.titulo)
    cursor = desenharTabelaCampos(doc, cursor, bloco.campos)
    cursor = desenharAnexadosPor(doc, cursor, bloco.tabelaHistoricoAnexos)
  }
  return finalizarDocumento(doc)
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

  for (const secao of montarSecoesApostilamentos(contrato.apostilamentos)) {
    documentos.push({ nome: `${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfApostilamento(secao) })
  }

  // Rescisão contratual: alteração contratual como o apostilamento, mesmo PDF.
  for (const secao of montarSecoesRescisoes(contrato.rescisoes)) {
    documentos.push({ nome: `${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfApostilamento(secao) })
  }

  // Suspensões contratuais e alterações de tipo desconhecido: mesma estrutura
  // do apostilamento (nenhuma alteração contratual pode ficar de fora).
  for (const secao of montarSecoesSuspensoes(contrato.suspensoes)) {
    documentos.push({ nome: `${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfApostilamento(secao) })
  }
  for (const secao of montarSecoesOutrasAlteracoes(contrato.outrasAlteracoes)) {
    documentos.push({ nome: `${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfApostilamento(secao) })
  }

  // Todas as solicitações de fornecimento agrupadas numa pasta só, com o número
  // da contratação (ex.: "solicitacoes-de-fornecimento-12-2026/") — pedido do usuário.
  const pastaSolicitacoes = slug(`solicitações de fornecimento ${tituloContrato(contrato).replace(/^contrato\s*/, '')}`)
  for (const secao of montarSecoesSolicitacoesFornecimento(contrato.solicitacoesFornecimento)) {
    documentos.push({ nome: `${pastaSolicitacoes}/${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfSolicitacaoFornecimento(secao) })
  }

  // Todas as interações contábeis agrupadas numa pasta só, "interações" + número
  // da contratação (ex.: "interacoes-12-2026/") — pedido do usuário.
  const pastaInteracoes = slug(`interações ${tituloContrato(contrato).replace(/^contrato\s*/, '')}`)
  for (const secao of montarSecoesInteracoesContabilidade(contrato.interacoesContabilidade)) {
    documentos.push({ nome: `${pastaInteracoes}/${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfInteracaoContabilidade(secao) })
  }

  for (const secao of montarSecoesRecebimentos(contrato.solicitacoesFornecimento)) {
    documentos.push({ nome: `${slug(secao.titulo)}.pdf`, gerar: () => gerarPdfRecebimentos(secao) })
  }

  // Sempre gerado, mesmo sem publicação (pedido do usuário: um por contratação).
  const publicacoes = montarDocumentoPublicacoes(contrato)
  documentos.push({ nome: `${slug(publicacoes.titulo)}.pdf`, gerar: () => gerarPdfPublicacoes(publicacoes) })

  // Sempre gerado, mesmo sem despesas (aí sai com o aviso), como as publicações.
  const despesas = montarDocumentoDespesas(contrato)
  documentos.push({ nome: `${slug(despesas.titulo)}.pdf`, gerar: () => gerarPdfDespesas(despesas) })

  // Sempre gerado, mesmo sem textos (pedido do usuário: um por contratação).
  const textos = montarDocumentoTextos(contrato)
  documentos.push({ nome: `${slug(textos.titulo)}.pdf`, gerar: () => gerarPdfTextos(textos) })

  return documentos
}
