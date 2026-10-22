// PDFs do relatório de um processo administrativo do Betha Compras Cloud —
// equivalente de pdf-relatorio.js (contratos), reaproveitando os mesmos
// blocos de desenho. Um PDF por documento: o do próprio processo (campos +
// tabelas de itens, lotes e participantes) e um por sub-recurso que tenha
// registros (pareceres, sessões de julgamento, atos finais, despesas,
// histórico e textos), com todos os campos de cada registro. As atas de
// registro de preço saem à parte, um PDF por ata (ver listarDocumentosAta).
import {
  MENSAGEM_SEM_ATAS,
  PASTA_ATAS_REGISTRO_PRECO,
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

    const tabela = montarTabelaGenerica(registros, excluir, processo)
    cursor = desenharTitulo(doc, cursor, `${rotulo} (${registros.length})`, 13)
    cursor = desenharTabelaDinamica(doc, cursor, tabela)

    cursor = desenharAvisoOmitidas(doc, cursor, tabela.omitidas)
  }

  return doc.output('blob')
}

// Aviso abaixo de uma tabela que não coube inteira no PDF.
function desenharAvisoOmitidas(doc, cursor, omitidas) {
  if (!(omitidas > 0)) return cursor
  cursor = garantirEspaco(doc, cursor, 16)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.text(`Mais ${omitidas} campo(s) por registro estão no relatório em Excel da Central de Dados.`, 40, cursor)
  doc.setFont('helvetica', 'normal')
  return cursor + 18
}

// PDF de UM sub-recurso: cada registro é um bloco com todos os campos. Sem
// registros (só os documentos que saem sempre, como o de textos), o aviso
// `documento.vazio`.
export function gerarPdfSubrecurso(documento) {
  const { doc, cursor: inicioDoc } = novoDocumento(documento.titulo)
  let cursor = inicioDoc
  if (!documento.blocos.length && documento.vazio) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.text(documento.vazio, 40, cursor)
    doc.setFont('helvetica', 'normal')
  }
  for (const bloco of documento.blocos) {
    cursor = desenharTitulo(doc, cursor, bloco.titulo, 12)
    cursor = desenharTabelaCampos(doc, cursor, bloco.campos)
  }
  return doc.output('blob')
}

// Documentos a gerar — um pro processo e um por sub-recurso com registros —
// sem gerar os bytes ainda (`gerar` é preguiçoso, pra um erro num documento
// não derrubar os demais; mesma regra de listarDocumentosRelatorio).
// As atas de registro de preço ficam de fora: cada uma vai pra sua subpasta
// em PASTA_ATAS_REGISTRO_PRECO (ver listarDocumentosAta).
export function listarDocumentosProcesso(processo) {
  const documentos = [{ nome: `${slug(tituloProcesso(processo))}.pdf`, gerar: () => gerarPdfProcesso(processo) }]
  for (const documento of montarDocumentosSubrecursos(processo)) {
    if (documento.chave === 'atas') continue
    documentos.push({ nome: `${slug(documento.titulo)}.pdf`, gerar: () => gerarPdfSubrecurso(documento) })
  }
  return documentos
}

// PDF de UMA ata de registro de preço (ver montarAtasRegistroPreco): todos os
// campos da ata e, se a API devolveu, a tabela dos itens dela.
export function gerarPdfAta(ata) {
  const { doc, cursor: inicio } = novoDocumento(ata.titulo)
  let cursor = desenharTabelaCampos(doc, inicio, ata.campos)
  if (ata.itens.linhas.length) {
    cursor = desenharTitulo(doc, cursor, `Itens da ata (${ata.itens.linhas.length})`, 13)
    cursor = desenharTabelaDinamica(doc, cursor, ata.itens)
    desenharAvisoOmitidas(doc, cursor, ata.itens.omitidas)
  }
  return doc.output('blob')
}

export function listarDocumentosAta(ata) {
  return [{ nome: `${slug(ata.titulo)}.pdf`, gerar: () => gerarPdfAta(ata) }]
}

// Processo de registro de preço ainda sem nenhuma ata: a pasta
// PASTA_ATAS_REGISTRO_PRECO sai mesmo assim, com um PDF avisando.
export function listarDocumentosSemAtas(processo) {
  const titulo = `${PASTA_ATAS_REGISTRO_PRECO.toLowerCase()} do ${tituloProcesso(processo)}`
  return [{ nome: `${slug(titulo)}.pdf`, gerar: () => gerarPdfSubrecurso({ titulo, blocos: [], vazio: MENSAGEM_SEM_ATAS }) }]
}
