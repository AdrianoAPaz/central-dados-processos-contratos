import { BETHA_CONTRATOS, ENDPOINT_CONTRATACOES, AMBIENTE_CONTRATACAO_TODAS, STORAGE_KEYS } from '../shared/constants.js'

let headersCapturados = null

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'headers-capturados') {
    headersCapturados = message.headers
    chrome.storage.session.set({ [STORAGE_KEYS.HEADERS]: message.headers }).catch(() => {})
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'status') {
    resolverHeaders().then((h) => sendResponse({ conectado: !!h }))
    return true
  }

  if (message.type === 'buscar-contrato') {
    buscarContrato(message.sequencial, message.numero, message.ano)
      .then(sendResponse)
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'enviar-para-central') {
    enviarParaCentral(message.contrato)
      .then(sendResponse)
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'buscar-aditivos') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.id)}/aditivos`)
      .then((aditivos) => sendResponse({ aditivos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'buscar-itens') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.id)}/itens`)
      .then((itens) => sendResponse({ itens }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Best-effort: caminho conjecturado (mesmo padrão dos demais sub-recursos
  // do Betha, `<endpoint>/<id>/<subrecurso>`), nunca confirmado ao vivo por
  // não haver sessão disponível pra testar. Se o caminho estiver errado, o
  // Betha deve responder 404 e isso vira simplesmente "sem itens
  // vinculados" no relatório — não trava nada. Se aparecer errado/vazio
  // onde deveria ter dados, é o primeiro lugar a corrigir.
  if (message.type === 'buscar-itens-aditivo') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.contratoId)}/aditivos/${limparId(message.aditivoId)}/itens`)
      .then((itens) => sendResponse({ itens }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Solicitações de fornecimento vinculadas ao contrato. Sub-recurso especial:
  // GET na coleção dá 405 no Betha — só é listável via este POST lookup (ver
  // buscarSolicitacoesFornecimento abaixo).
  if (message.type === 'buscar-solicitacoes-fornecimento') {
    buscarSolicitacoesFornecimento(message.id)
      .then((solicitacoes) => sendResponse({ solicitacoes }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Baixa um anexo do Betha com o header de sessão e devolve os bytes em
  // base64 — não usa `chrome.downloads` (exigiria permissão nova no manifest,
  // que derruba a extensão até reaprovação da Chrome Web Store). Quem chamou
  // (report.js, que roda numa página com DOM completo) monta o Blob e
  // dispara o download local a partir dos bytes já recebidos.
  if (message.type === 'baixar-anexo') {
    baixarAnexo(message.arquivoId)
      .then(sendResponse)
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }
})

function limparId(id) {
  return String(id || '').replace(/[^\w-]/g, '')
}

async function resolverHeaders() {
  if (headersCapturados) return headersCapturados
  const stored = await chrome.storage.session.get(STORAGE_KEYS.HEADERS)
  headersCapturados = stored[STORAGE_KEYS.HEADERS] || null
  return headersCapturados
}

function montarAuthorization(auth) {
  return /^bearer\s/i.test(auth || '') ? auth : `Bearer ${auth}`
}

async function chamarBetha(filter) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const params = new URLSearchParams({
    ambienteContratacao: AMBIENTE_CONTRATACAO_TODAS,
    contratosDeOutrasEntidades: 'false',
    filter,
    limit: '20',
    offset: '0',
    sort: '',
    total: 'false',
  })
  const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${ENDPOINT_CONTRATACOES}?${params}`

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: montarAuthorization(headers.authorization),
      'App-Context': headers.appContext,
      'User-Access': headers.userAccess,
    },
  })
  if (!resp.ok) throw new Error(`API do Betha respondeu ${resp.status}`)
  const dados = await resp.json()
  return dados.content || []
}

async function buscarContrato(sequencial, numero, ano) {
  const seqLimpo = String(sequencial || '').replace(/\D/g, '')
  if (seqLimpo) {
    return { candidatos: await chamarBetha(`(((sequencial = ${seqLimpo})))`) }
  }

  const numLimpo = String(numero || '').replace(/\D/g, '')
  if (!numLimpo) throw new Error('Informe o sequencial ou o número do contrato.')
  const anoLimpo = String(ano || '').replace(/\D/g, '')
  const filter = anoLimpo
    ? `(((numeroTermoNumerico = ${numLimpo} and ano = ${anoLimpo})))`
    : `(((numeroTermoNumerico = ${numLimpo})))`
  return { candidatos: await chamarBetha(filter) }
}

// Sub-recurso genérico `<caminho>` (ex.: `contratacoes/{id}/aditivos`,
// `contratacoes/{id}/itens`) — mesmo padrão paginado de qualquer endpoint do
// Betha. Somente leitura; devolve os itens crus (sem supor nomes de campo
// que não foram confirmados ao vivo). 404 vira lista vazia (sub-recurso sem
// registros cadastrados), não erro — é um estado normal, não uma falha.
async function buscarSubrecurso(caminho) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const PAGINA = 50
  const MAX = 500
  const todos = []
  let offset = 0
  let hasNext = true

  while (hasNext && offset < MAX) {
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGINA) })
    const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${caminho}?${params}`
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
      },
    })
    if (!resp.ok) {
      if (offset === 0 && (resp.status === 404 || resp.status === 400)) return []
      throw new Error(`API do Betha respondeu ${resp.status} ao buscar ${caminho}`)
    }
    const dados = await resp.json()
    const pagina = Array.isArray(dados) ? dados : (dados.content || [])
    todos.push(...pagina)
    if (Array.isArray(dados) || !pagina.length) break
    hasNext = !!dados.hasNext
    offset += PAGINA
  }

  return todos
}

// Lookup POST — único sub-recurso do Betha Contratos que exige POST pra
// listar (GET na coleção de solicitacoesfornecimento responde 405; confirmado
// no projeto irmão Delta Intelligence, 2026-07-03/2026-07-16). Uso
// estritamente somente-leitura: pesquisa/filtra, nunca grava nada — mesma
// exceção já autorizada e validada lá.
async function postLookupBetha(caminho, corpoBase) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const accept = 'application/json, application/vnd.betha.lookup.LISTA+json'
  const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${caminho}?Accept=${encodeURIComponent(accept)}`

  const PAGINA = 20
  const MAX = 200
  const todos = []
  let offset = 0
  let hasNext = true

  while (hasNext && offset < MAX) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
        'Content-Type': 'application/json',
        Accept: accept,
      },
      body: JSON.stringify({ ...corpoBase, limit: PAGINA, offset }),
    })
    if (!resp.ok) throw new Error(`API do Betha respondeu ${resp.status} ao buscar ${caminho}`)
    const dados = await resp.json()
    const pagina = Array.isArray(dados.content) ? dados.content : []
    todos.push(...pagina)
    if (!pagina.length || !dados.hasNext) break
    hasNext = !!dados.hasNext
    offset += PAGINA
  }

  return todos
}

// Solicitações de fornecimento vinculadas a um contrato. Endpoint e corpo
// confirmados ao vivo no projeto irmão Delta Intelligence (2026-07-16,
// contrato real 123/2026): passar o id REAL do contrato no path (em vez do
// "0" usado na busca global por número) já escopa a lista pra esse contrato,
// sem precisar filtrar depois — `filter: ''` e `gestaosolicitacoes: false`
// (diferente da busca global por número, que usa filtro de texto e `true`).
async function buscarSolicitacoesFornecimento(contratoId) {
  const caminho = `${ENDPOINT_CONTRATACOES}/${limparId(contratoId)}/solicitacoesfornecimento/solicitacao-fornecimento-filtros`
  return postLookupBetha(caminho, {
    filter: '',
    ambienteContratacao: AMBIENTE_CONTRATACAO_TODAS,
    total: false,
    sort: 'data desc, numeroSolicitacao desc',
    gestaosolicitacoes: false,
  })
}

async function enviarParaCentral(contrato) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.BACKEND_URL)
  const backendUrl = stored[STORAGE_KEYS.BACKEND_URL]
  if (!backendUrl) throw new Error('Configure a URL da Central de Dados nas Opções da extensão.')

  const resp = await fetch(`${backendUrl.replace(/\/$/, '')}/api/contratos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contrato),
  })
  if (!resp.ok) {
    const texto = await resp.text().catch(() => '')
    throw new Error(`Central de Dados respondeu ${resp.status}: ${texto}`)
  }
  return resp.json()
}

// Teto de tamanho por download — acima disso o pico de memória (ArrayBuffer +
// string binária + base64, ~5-6x o tamanho do arquivo) e o limite prático de
// serialização de mensagens da extensão (~64MB) fariam o download falhar de
// um jeito confuso em vez de dar um aviso claro. Mesmo limite usado e testado
// no projeto irmão Delta Intelligence.
const TAMANHO_MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024 // 30MB
const TIMEOUT_DOWNLOAD_MS = 60000

// Codifica em base64 sem `Buffer` (indisponível no service worker), em blocos
// de 32KB pra não estourar a pilha em arquivos grandes.
function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// Download de um anexo do contrato. URL confirmada ao vivo no projeto irmão
// Delta Intelligence (2026-07-16, mesma API do Betha Contratos):
// `<basePath>/arquivos/{id}/conteudo`, GET com o mesmo header de sessão dos
// demais endpoints — o objeto do anexo em si nunca traz uma URL pronta (só
// id/nome/tipo/tamanho), por isso um `<a href>` direto sempre falharia sem
// esses headers de autenticação.
async function baixarAnexo(arquivoId) {
  if (!arquivoId) return { erro: 'Anexo sem id para download.' }
  // Ids reais são UUID (ex.: "42b0df52-..."); qualquer coisa fora desse
  // formato é rejeitada antes de entrar na URL — defesa em profundidade
  // contra manipulação do caminho de uma requisição autenticada.
  if (!/^[A-Za-z0-9-]+$/.test(String(arquivoId))) {
    return { erro: 'Id de anexo inválido.' }
  }

  const headers = await resolverHeaders()
  if (!headers) {
    return { erro: 'Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.' }
  }

  const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/arquivos/${arquivoId}/conteudo`
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
      },
      signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS),
    })
  } catch (e) {
    const timeout = e && e.name === 'TimeoutError'
    return { erro: timeout ? 'Tempo esgotado ao baixar o anexo. Tente novamente.' : `Falha de rede ao baixar: ${String((e && e.message) || e)}` }
  }
  if (!response.ok) {
    return { erro: `Falha ao baixar (${response.status})` }
  }

  const tamanhoAnunciado = Number(response.headers.get('Content-Length'))
  if (tamanhoAnunciado > TAMANHO_MAX_DOWNLOAD_BYTES) {
    return { erro: `Anexo muito grande para baixar pela extensão (${(tamanhoAnunciado / 1024 / 1024).toFixed(1)}MB). Baixe direto pelo Betha.` }
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > TAMANHO_MAX_DOWNLOAD_BYTES) {
    return { erro: `Anexo muito grande para baixar pela extensão (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB). Baixe direto pelo Betha.` }
  }

  const mimeType = response.headers.get('Content-Type') || 'application/octet-stream'
  return { success: true, base64: arrayBufferToBase64(buffer), mimeType }
}
