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
    buscarAditivos(message.id)
      .then((aditivos) => sendResponse({ aditivos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }
})

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

// Sub-recurso `contratacoes/{id}/aditivos` — confirmado como existente
// (200) no Delta-Intelligence (CONTEXTO_PROJETO.md §5), mas sem catálogo de
// campos confirmado ainda. Somente leitura, paginado como qualquer outro
// endpoint do Betha; devolve os itens crus (sem supor nomes de campo que não
// foram confirmados ao vivo).
async function buscarAditivos(contratacaoId) {
  const idLimpo = String(contratacaoId || '').replace(/[^\w-]/g, '')
  if (!idLimpo) throw new Error('Contrato sem id para buscar aditivos.')

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
    const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${ENDPOINT_CONTRATACOES}/${idLimpo}/aditivos?${params}`
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
      },
    })
    if (!resp.ok) {
      if (offset === 0 && resp.status === 404) return [] // contrato sem aditivos cadastrados
      throw new Error(`API do Betha respondeu ${resp.status} ao buscar aditivos`)
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
