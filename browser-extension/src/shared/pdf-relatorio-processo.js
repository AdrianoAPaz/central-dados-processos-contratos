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
  montarDocumentosParticipantesIndividuais,
  montarDocumentosSubrecursos,
  montarTabelaAnexadosProcesso,
  montarTabelaGenerica,
  subrecurso,
  tituloProcesso,
} from './campos-relatorio-processo.js'
import {
  desenharTabelaCampos,
  desenharTabelaDinamica,
  desenharAviso,
  desenharTitulo,
  finalizarDocumento,
  novoDocumento,
  slug,
} from './pdf-relatorio.js'

// PDF do processo: dados + tabelas de itens, lotes e participantes.
export function gerarPdfProcesso(processo) {
  const { doc, cursor: inicio } = novoDocumento(tituloProcesso(processo))
  let cursor = desenharTabelaCampos(doc, inicio, montarCamposProcesso(processo))

  for (const { chave, rotulo, excluir, montar } of SUBRECURSOS_EM_TABELA) {
    const registros = subrecurso(processo, chave)
    if (!registros.length) continue

    const tabela = montar ? montar(registros, processo) : montarTabelaGenerica(registros, excluir, processo)
    cursor = desenharTitulo(doc, cursor, `${rotulo} (${registros.length})`)
    cursor = desenharTabelaDinamica(doc, cursor, tabela)

    cursor = desenharAvisoOmitidas(doc, cursor, tabela.omitidas)
  }

  // Trilha de auditoria dos anexos: quem anexou cada arquivo e quando.
  desenharTabelaAnexados(doc, cursor, montarTabelaAnexadosProcesso(processo))

  return finalizarDocumento(doc)
}

function desenharTabelaAnexados(doc, cursor, tabela) {
  if (!tabela || !tabela.linhas.length) return cursor
  return desenharTabelaDinamica(doc, desenharTitulo(doc, cursor, 'Anexados por'), tabela)
}

// Aviso abaixo de uma tabela que não coube inteira no PDF.
function desenharAvisoOmitidas(doc, cursor, omitidas) {
  if (!(omitidas > 0)) return cursor
  return desenharAviso(doc, cursor, `Mais ${omitidas} campo(s) por registro estão no relatório em Excel da Central de Dados.`, 8)
}

// PDF de UM sub-recurso: cada registro é um bloco com todos os campos. Sem
// registros (só os documentos que saem sempre, como o de textos), o aviso
// `documento.vazio`.
export function gerarPdfSubrecurso(documento) {
  const { doc, cursor: inicioDoc } = novoDocumento(documento.titulo)
  let cursor = inicioDoc
  if (!documento.blocos.length && documento.vazio) {
    cursor = desenharAviso(doc, cursor, documento.vazio)
  }
  // Histórico: resumo cronológico (quem, quando, situação) antes do detalhe.
  if (documento.tabelaHistorico && documento.tabelaHistorico.linhas.length) {
    cursor = desenharTitulo(doc, cursor, `Trilha de auditoria (${documento.tabelaHistorico.linhas.length})`)
    cursor = desenharTabelaDinamica(doc, cursor, documento.tabelaHistorico)
  }
  for (const bloco of documento.blocos) {
    cursor = desenharTitulo(doc, cursor, bloco.titulo)
    cursor = desenharTabelaCampos(doc, cursor, bloco.campos)
  }
  return finalizarDocumento(doc)
}

// Documentos a gerar — um pro processo e um por sub-recurso com registros —
// sem gerar os bytes ainda (`gerar` é preguiçoso, pra um erro num documento
// não derrubar os demais; mesma regra de listarDocumentosRelatorio).
// As atas de registro de preço ficam de fora: cada uma vai pra sua subpasta
// em PASTA_ATAS_REGISTRO_PRECO (ver listarDocumentosAta).
export function listarDocumentosProcesso(processo) {
  const documentos = [{ nome: `${slug(tituloProcesso(processo))}.pdf`, gerar: () => gerarPdfProcesso(processo) }]
  for (const documento of montarDocumentosSubrecursos(processo)) {
    if (documento.chave === 'atas' || documento.chave === 'participantes') continue
    documentos.push({ nome: `${slug(documento.arquivo || documento.titulo)}.pdf`, gerar: () => gerarPdfSubrecurso(documento) })
  }
  return documentos
}

// Um PDF por participante (com as propostas dele), pra pasta
// PASTA_PARTICIPANTES do zip.
export function listarDocumentosParticipantes(processo) {
  return montarDocumentosParticipantesIndividuais(processo).map((documento) => ({
    nome: `${slug(documento.titulo)}.pdf`,
    gerar: () => gerarPdfParticipante(documento),
  }))
}

// PDF de UM participante: os campos dele e, em lista, as propostas por item.
function gerarPdfParticipante(documento) {
  const { doc, cursor: inicio } = novoDocumento(documento.titulo)
  let cursor = inicio
  for (const bloco of documento.blocosParticipante) {
    cursor = desenharTitulo(doc, cursor, bloco.titulo)
    cursor = desenharTabelaCampos(doc, cursor, bloco.campos)
  }
  const { propostas } = documento
  cursor = desenharTitulo(doc, cursor, `Propostas do participante (${propostas.linhas.length})`)
  if (propostas.linhas.length) {
    cursor = desenharTabelaDinamica(doc, cursor, propostas)
    desenharAvisoOmitidas(doc, cursor, propostas.omitidas)
  } else {
    desenharAviso(doc, cursor, 'Nenhuma proposta encontrada')
  }
  return finalizarDocumento(doc)
}

// PDF de UMA ata de registro de preço (ver montarAtasRegistroPreco): todos os
// campos da ata e, se a API devolveu, a tabela dos itens dela.
export function gerarPdfAta(ata) {
  const { doc, cursor: inicio } = novoDocumento(ata.titulo)
  let cursor = desenharTabelaCampos(doc, inicio, ata.campos)
  if (ata.itens.linhas.length) {
    cursor = desenharTitulo(doc, cursor, `Itens da ata (${ata.itens.linhas.length})`)
    cursor = desenharTabelaDinamica(doc, cursor, ata.itens)
    cursor = desenharAvisoOmitidas(doc, cursor, ata.itens.omitidas)
  }
  if (ata.ocorrencias && ata.ocorrencias.linhas.length) {
    cursor = desenharTitulo(doc, cursor, `Ocorrências da ata (${ata.ocorrencias.linhas.length})`)
    cursor = desenharTabelaDinamica(doc, cursor, ata.ocorrencias)
    cursor = desenharAvisoOmitidas(doc, cursor, ata.ocorrencias.omitidas)
  }
  desenharTabelaAnexados(doc, cursor, ata.tabelaAnexados)
  return finalizarDocumento(doc)
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
