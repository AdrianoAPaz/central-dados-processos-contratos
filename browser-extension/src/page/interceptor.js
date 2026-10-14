// Roda no mundo MAIN (document_start) - só assim consegue sobrescrever
// window.fetch/XMLHttpRequest da própria página do Betha para capturar os
// headers de autenticação que o SPA já envia. Não tem acesso a chrome.* (ver
// content/bridge.js, que repassa ao service worker). Padrão adaptado do
// Delta Intelligence (browser-extension/src/page/interceptor.js), restrito
// só ao Betha Contratos.
;(function () {
  // Este script roda tanto no Betha Contratos quanto no Betha Compras Cloud
  // (ver manifest.json). No Contratos só interessa a API conhecida; no
  // Compras o host da API ainda não foi confirmado ao vivo, então vale
  // qualquer requisição pra *.betha.cloud — `extrairAuth` já exige os três
  // headers de sessão do Betha, então só chamadas reais de API passam. A
  // origem + prefixo `/.../api` observados vão junto, pra extensão não
  // depender do palpite de constants.js (BETHA_COMPRAS).
  const SISTEMA_DA_PAGINA = window.location.hostname === 'compras.betha.cloud' ? 'compras' : 'contratos'

  // Contexto (entidade + exercício) do Compras, na URL da própria página:
  // `#/entidades/<token base64>/exercicios/<ano>` (formato confirmado no
  // projeto irmão Delta Intelligence). No Compras o ano de um processo É o
  // exercício do contexto, e a entidade só é resolvida pelo token da URL —
  // por isso a sessão capturada só vale pra esse par.
  function contextoDaPagina() {
    const hash = window.location.hash || ''
    const entidade = (hash.match(/#\/entidades\/([^/?#]+)/) || [])[1] || ''
    const exercicio = (hash.match(/exercicios\/(\d{4})/) || [])[1] || ''
    return { entidade, exercicio }
  }

  function infoDaApi(url) {
    try {
      const u = new URL(url, window.location.href)
      if (SISTEMA_DA_PAGINA === 'contratos') {
        return u.hostname === 'api.contratos.betha.cloud' ? { sistema: 'contratos' } : null
      }
      if (u.protocol !== 'https:' || !/(^|\.)betha\.cloud$/.test(u.hostname)) return null
      const prefixo = u.pathname.match(/^(.*?\/api)(\/|$)/)
      return { sistema: 'compras', apiOrigin: u.origin, apiBasePath: prefixo ? prefixo[1] : '', contexto: contextoDaPagina() }
    } catch {
      return null
    }
  }

  function extrairAuth(headers) {
    const auth = headers['authorization'] || ''
    const appContext = headers['app-context'] || headers['app_context'] || ''
    const userAccess = headers['user-access'] || headers['user_access'] || headers['useraccess'] || ''
    if (auth && appContext && userAccess) return { authorization: auth, appContext, userAccess }
    return null
  }

  function despachar(headers, info) {
    const auth = extrairAuth(headers)
    if (!auth) return
    window.postMessage({ __centralDadosType: 'headers-capturados', headers: auth, ...info }, '*')
  }

  function headersDeFetchInit(init) {
    const headers = {}
    const h = (init && init.headers) || null
    if (!h) return headers
    if (h instanceof Headers) h.forEach((v, k) => { headers[k.toLowerCase()] = v })
    else if (Array.isArray(h)) h.forEach(([k, v]) => { headers[k.toLowerCase()] = v })
    else if (typeof h === 'object') Object.keys(h).forEach((k) => { headers[k.toLowerCase()] = h[k] })
    return headers
  }

  const originalFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    const info = infoDaApi(url)
    if (info) {
      // `new Request(url, { headers })` também é usado pelos SPAs — os headers
      // podem estar no próprio Request, não só no `init`.
      const headers = headersDeFetchInit(init)
      if (input instanceof Request) input.headers.forEach((v, k) => { if (!(k in headers)) headers[k] = v })
      despachar(headers, info)
    }
    return originalFetch(input, init)
  }

  const XHRProto = XMLHttpRequest.prototype
  const originalOpen = XHRProto.open
  const originalSetRequestHeader = XHRProto.setRequestHeader
  const originalSend = XHRProto.send

  XHRProto.open = function (method, url) {
    this.__cd_url = typeof url === 'string' ? url : (url ? String(url) : '')
    this.__cd_headers = {}
    return originalOpen.apply(this, arguments)
  }

  XHRProto.setRequestHeader = function (name, value) {
    if (this.__cd_headers) this.__cd_headers[name.toLowerCase()] = value
    return originalSetRequestHeader.apply(this, arguments)
  }

  XHRProto.send = function (body) {
    const info = this.__cd_url ? infoDaApi(this.__cd_url) : null
    if (info) {
      despachar(this.__cd_headers || {}, info)
    }
    return originalSend.apply(this, arguments)
  }
})()
