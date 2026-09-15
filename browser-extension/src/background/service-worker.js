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
