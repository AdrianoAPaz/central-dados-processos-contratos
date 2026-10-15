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
import { baixarBlob, base64ParaBytes, nomeAnexo, nomeUnicoNoZip } from '../shared/pacote.js'

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

  const usados = new Set()
  const baixados = []
  const pasta = `Anexos do processo numero ${numeroParaArquivo(processo)}`

  // Um PDF por documento (o processo e cada sub-recurso com registros) — cada
  // um gera e falha independente dos demais.
  for (const documento of listarDocumentosProcesso(processo)) {
    const li = document.createElement('li')
    li.textContent = `⏳ ${documento.nome}`
    lista.appendChild(li)
    try {
      const pdfBlob = documento.gerar()
      baixados.push({ nome: nomeUnicoNoZip(documento.nome, usados), bytes: new Uint8Array(await pdfBlob.arrayBuffer()) })
      li.textContent = `✅ ${documento.nome}`
    } catch (e) {
      li.textContent = `⚠️ ${documento.nome} — erro: ${String((e && e.message) || e)}`
    }
  }

  for (const anexo of anexos) {
    const li = document.createElement('li')
    li.textContent = `⏳ ${anexo.origem} — ${nomeAnexo(anexo)}`
    lista.appendChild(li)

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'baixar-anexo', arquivoId: anexo.id, sistema: 'compras' })
      if (!resp || resp.erro || resp.success !== true || typeof resp.base64 !== 'string') {
        li.textContent = `⚠️ ${anexo.origem} — ${nomeAnexo(anexo)} (falha: ${(resp && resp.erro) || 'sem retorno'})`
        continue
      }
      baixados.push({ nome: `${pasta}/${nomeUnicoNoZip(nomeAnexo(anexo), usados)}`, bytes: base64ParaBytes(resp.base64) })
      li.textContent = `✅ ${anexo.origem} — ${nomeAnexo(anexo)}`
    } catch (e) {
      li.textContent = `⚠️ ${anexo.origem} — ${nomeAnexo(anexo)} (erro: ${String((e && e.message) || e)})`
    }
  }

  if (!baixados.length) return

  const nomeZip = `anexos-processo-${numeroParaArquivo(processo)}.zip`
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
  for (const { chave, rotulo } of SUBRECURSOS_EM_TABELA) {
    const registros = subrecurso(processo, chave)
    const tabela = criarTabelaDinamica(montarTabelaGenerica(registros))
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
