// Gera o mesmo relatório da tela (report.js) como PDF de verdade, pra
// empacotar junto com os anexos no zip (pedido do usuário) — `window.print()`
// não devolve bytes, só abre o diálogo nativo do navegador, por isso não dá
// pra usá-lo aqui. Usa jsPDF + jspdf-autotable vendorizados em
// `src/vendor/` (ver README ali sobre por que são UMD e não ESM).
import {
  montarCamposRelatorio,
  montarSecoesAditivos,
  montarTabelaItens,
  montarSecoesSolicitacoesFornecimento,
} from './campos-relatorio.js'

const MARGEM = 40

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
function garantirEspaco(doc, cursor, alturaMinima) {
  const alturaPagina = doc.internal.pageSize.getHeight()
  if (cursor + alturaMinima > alturaPagina - MARGEM) {
    doc.addPage()
    return MARGEM
  }
  return cursor
}

function desenharTitulo(doc, cursor, texto, tamanhoFonte) {
  cursor = garantirEspaco(doc, cursor, tamanhoFonte + 10)
  doc.setFontSize(tamanhoFonte)
  doc.setFont('helvetica', 'bold')
  doc.text(texto, MARGEM, cursor)
  doc.setFont('helvetica', 'normal')
  return cursor + tamanhoFonte + 6
}

// Tabela de 2 colunas (label/valor) — mesmo formato da tabela de campos do
// contrato/aditivo/solicitação na tela.
function desenharTabelaCampos(doc, cursor, campos) {
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
function desenharTabelaDinamica(doc, cursor, { colunas, linhas }) {
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

// Devolve um Blob (application/pdf) — pronto pra virar bytes (arrayBuffer)
// e entrar no zip, ou pra download direto se um dia precisar sozinho.
export function gerarPdfRelatorio(contrato) {
  const jsPDF = obterJsPDF()
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let cursor = MARGEM

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Relatório de contrato', MARGEM, cursor)
  cursor += 18
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Central de Dados de Processos e Contratos', MARGEM, cursor)
  cursor += 22

  cursor = desenharTabelaCampos(doc, cursor, montarCamposRelatorio(contrato))

  const tabelaItens = montarTabelaItens(contrato.itens)
  if (tabelaItens.linhas.length) {
    cursor = desenharTitulo(doc, cursor, `Itens do contrato (${contrato.itens.length})`, 13)
    cursor = desenharTabelaDinamica(doc, cursor, tabelaItens)
  }

  const secoesAditivos = montarSecoesAditivos(contrato.aditivos)
  if (secoesAditivos.length) {
    cursor = desenharTitulo(doc, cursor, `Aditivos (${secoesAditivos.length})`, 13)
    for (const secao of secoesAditivos) {
      cursor = desenharTitulo(doc, cursor, secao.titulo, 11)
      cursor = desenharTabelaCampos(doc, cursor, secao.campos)
      if (secao.tabelaItens.linhas.length) {
        cursor = desenharTabelaDinamica(doc, cursor, secao.tabelaItens)
      } else {
        cursor = garantirEspaco(doc, cursor, 16)
        doc.setFontSize(9)
        doc.setFont('helvetica', 'italic')
        doc.text(`${secao.titulo} sem itens vinculados`, MARGEM, cursor)
        doc.setFont('helvetica', 'normal')
        cursor += 18
      }
    }
  }

  const secoesSf = montarSecoesSolicitacoesFornecimento(contrato.solicitacoesFornecimento)
  if (secoesSf.length) {
    cursor = desenharTitulo(doc, cursor, `Solicitações de fornecimento (${secoesSf.length})`, 13)
    for (const secao of secoesSf) {
      cursor = desenharTitulo(doc, cursor, secao.titulo, 11)
      cursor = desenharTabelaCampos(doc, cursor, secao.campos)
    }
  }

  return doc.output('blob')
}
