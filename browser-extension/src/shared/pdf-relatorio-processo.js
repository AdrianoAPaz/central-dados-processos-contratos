// PDFs do relatório de um processo administrativo do Betha Compras Cloud —
// equivalente de pdf-relatorio.js (contratos), reaproveitando os mesmos
// blocos de desenho. Um PDF por documento: o do próprio processo (campos +
// tabelas de itens, lotes e participantes) e um por sub-recurso que tenha
// registros (pareceres, sessões de julgamento, atos finais, despesas,
// histórico, atas e textos), com todos os campos de cada registro.
import {
  SUBRECURSOS_EM_TABELA,
  montarCamposProcesso,
  montarDocumentosSubrecursos,
  montarTabelaGenerica,
  subrecurso,
  tituloProcesso,
} from './campos-relatorio-processo.js'
import {
  desenharTabelaCampos,
  desenharTabelaDinamica,
  desenharTitulo,
  garantirEspaco,
  novoDocumento,
  slug,
} from './pdf-relatorio.js'

// PDF do processo: dados + tabelas de itens, lotes e participantes.
export function gerarPdfProcesso(processo) {
  const { doc, cursor: inicio } = novoDocumento(tituloProcesso(processo))
  let cursor = desenharTabelaCampos(doc, inicio, montarCamposProcesso(processo))

  for (const { chave, rotulo, excluir } of SUBRECURSOS_EM_TABELA) {
    const registros = subrecurso(processo, chave)
    if (!registros.length) continue

    const tabela = montarTabelaGenerica(registros, excluir)
    cursor = desenharTitulo(doc, cursor, `${rotulo} (${registros.length})`, 13)
    cursor = desenharTabelaDinamica(doc, cursor, tabela)

    if (tabela.omitidas > 0) {
      cursor = garantirEspaco(doc, cursor, 16)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'italic')
      doc.text(`Mais ${tabela.omitidas} campo(s) por registro estão no relatório em Excel da Central de Dados.`, 40, cursor)
      doc.setFont('helvetica', 'normal')
      cursor += 18
    }
  }

  return doc.output('blob')
}

// PDF de UM sub-recurso: cada registro é um bloco com todos os campos.
export function gerarPdfSubrecurso(documento) {
  const { doc, cursor: inicioDoc } = novoDocumento(documento.titulo)
  let cursor = inicioDoc
  for (const bloco of documento.blocos) {
    cursor = desenharTitulo(doc, cursor, bloco.titulo, 12)
    cursor = desenharTabelaCampos(doc, cursor, bloco.campos)
  }
  return doc.output('blob')
}

// Documentos a gerar — um pro processo e um por sub-recurso com registros —
// sem gerar os bytes ainda (`gerar` é preguiçoso, pra um erro num documento
// não derrubar os demais; mesma regra de listarDocumentosRelatorio).
export function listarDocumentosProcesso(processo) {
  const documentos = [{ nome: `${slug(tituloProcesso(processo))}.pdf`, gerar: () => gerarPdfProcesso(processo) }]
  for (const documento of montarDocumentosSubrecursos(processo)) {
    documentos.push({ nome: `${slug(documento.titulo)}.pdf`, gerar: () => gerarPdfSubrecurso(documento) })
  }
  return documentos
}
