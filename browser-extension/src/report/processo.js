// Página de relatório de um processo administrativo do Betha Compras Cloud —
// equivalente de report.js (contratos): mostra uma prévia na tela e, ao abrir,
// gera um PDF por documento e baixa os anexos via service worker (que tem a
// sessão do Compras), agrupando tudo num único .zip.
import {
  SUBRECURSOS_EM_TABELA,
  montarCamposProcesso,
  montarDocumentosSubrecursos,
  montarTabelaGenerica,
  numeroProcesso,
  subrecurso,
} from '../shared/campos-relatorio-processo.js'
import { criarZip } from '../shared/zip.js'
import { listarDocumentosProcesso } from '../shared/pdf-relatorio-processo.js'
import { criarTabelaCampos, criarTabelaDinamica } from '../shared/dom-relatorio.js'
import { listarDocumentosRelatorio } from '../shared/pdf-relatorio.js'
import { baixarBlob, coletarArquivosPacote, nomeUnicoNoZip } from '../shared/pacote.js'
import { coletarAnexosContrato, numeroContrato, pastaAnexosContrato } from '../shared/pacote-contrato.js'

const STORAGE_KEY = 'centralDados.relatorioProcessoAtual'

// Anexos (metadados: nome/id/tipo/tamanho) do processo — montados pelo service
// worker a partir do campo inline `arquivos` e dos `textos` (ver
// coletarAnexosProcesso em service-worker.js).
function coletarAnexos(processo) {
  return subrecurso(processo, 'anexos')
    .map((a) => ({ ...a, origem: 'Processo' }))
    .filter((a) => a && a.id)
}

function numeroParaArquivo(processo) {
  return numeroProcesso(processo).replace(/[^\w-]+/g, '-')
}

// Gera os PDFs e baixa cada anexo, um de cada vez (rajada de requisições
// autenticadas arrisca rate-limit oculto no Betha — mesma cautela do relatório
// de contratos), agrupando tudo num único .zip.
async function montarPacoteRelatorio(processo, anexos, container) {
  const titulo = document.createElement('h2')
  titulo.textContent = 'Anexos e relatório em PDF'
  container.appendChild(titulo)

  const lista = document.createElement('ul')
  lista.className = 'lista-anexos'
  container.appendChild(lista)

  const numero = numeroParaArquivo(processo)
  const contratacoes = Array.isArray(processo.contratacoesVinculadas) ? processo.contratacoesVinculadas : []
  // Sem contratações vinculadas o zip continua só com os arquivos do processo,
  // soltos na raiz. Com elas, o zip ganha duas pastas: a do processo e a de
  // "Contratações" (uma subpasta por contratação, com os PDFs e anexos dela).
  const prefixoProcesso = contratacoes.length ? `Proc Adm ${numero}/` : ''

  // Um PDF por documento (o processo e cada sub-recurso com registros) — cada
  // um gera e falha independente dos demais.
  const baixados = await coletarArquivosPacote({
    documentos: listarDocumentosProcesso(processo),
    anexos,
    prefixo: prefixoProcesso,
    pasta: `Anexos do processo numero ${numero}`,
    sistema: 'compras',
    lista,
  })

  const pastasUsadas = new Set()
  for (const contratacao of contratacoes) {
    const nomePasta = nomeUnicoNoZip(`Contratação ${numeroContrato(contratacao)}`, pastasUsadas)
    baixados.push(
      ...(await coletarArquivosPacote({
        documentos: listarDocumentosRelatorio(contratacao),
        anexos: coletarAnexosContrato(contratacao),
        prefixo: `Contratações/${nomePasta}/`,
        pasta: pastaAnexosContrato(contratacao),
        lista,
        rotulo: `${nomePasta} — `,
      })),
    )
  }

  if (!baixados.length) return

  const nomeZip = contratacoes.length ? `processo-${numero}-com-contratacoes.zip` : `anexos-processo-${numero}.zip`
  baixarBlob(criarZip(baixados), nomeZip)

  const resumo = document.createElement('p')
  resumo.className = 'sem-itens'
  resumo.textContent = `${baixados.length} arquivo(s) agrupado(s) em ${nomeZip}`
  container.appendChild(resumo)
}

async function carregar() {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const processo = stored[STORAGE_KEY]

  if (!processo) {
    document.getElementById('vazio').hidden = false
    document.getElementById('imprimir').disabled = true
    return
  }

  document.getElementById('tabela').replaceWith(criarTabelaCampos(montarCamposProcesso(processo)))

  // Itens, lotes e participantes — tabelas logo abaixo dos dados do processo.
  const containerTabelas = document.getElementById('tabelas')
  for (const { chave, rotulo, excluir } of SUBRECURSOS_EM_TABELA) {
    const registros = subrecurso(processo, chave)
    const tabela = criarTabelaDinamica(montarTabelaGenerica(registros, excluir, processo))
    if (!tabela) continue
    const h2 = document.createElement('h2')
    h2.textContent = `${rotulo} (${registros.length})`
    containerTabelas.appendChild(h2)
    containerTabelas.appendChild(tabela)
  }

  // Demais sub-recursos — um bloco por registro, com todos os campos.
  const containerDocumentos = document.getElementById('documentos')
  for (const documento of montarDocumentosSubrecursos(processo)) {
    const h2 = document.createElement('h2')
    h2.textContent = `${documento.titulo.charAt(0).toUpperCase()}${documento.titulo.slice(1)} (${documento.blocos.length})`
    containerDocumentos.appendChild(h2)

    if (!documento.blocos.length && documento.vazio) {
      const vazio = document.createElement('p')
      vazio.className = 'sem-itens'
      vazio.textContent = documento.vazio
      containerDocumentos.appendChild(vazio)
    }
    for (const bloco of documento.blocos) {
      const div = document.createElement('div')
      div.className = 'aditivo-secao'
      const h3 = document.createElement('h3')
      h3.textContent = bloco.titulo
      div.appendChild(h3)
      div.appendChild(criarTabelaCampos(bloco.campos))
      containerDocumentos.appendChild(div)
    }
  }

  // Gera os PDFs e baixa os anexos automaticamente ao abrir a aba, agrupando
  // tudo num único .zip — mesmo comportamento do relatório de contratos.
  await montarPacoteRelatorio(processo, coletarAnexos(processo), document.getElementById('anexos'))

  // Consumido uma vez — evita reabrir a mesma aba (ex.: F5) mostrando dados de
  // um relatório antigo por engano.
  await chrome.storage.local.remove(STORAGE_KEY)
}

document.getElementById('imprimir').addEventListener('click', () => window.print())

carregar()
