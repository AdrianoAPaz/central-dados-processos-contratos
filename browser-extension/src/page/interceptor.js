// Roda no mundo MAIN (document_start) - só assim consegue sobrescrever
// window.fetch/XMLHttpRequest da própria página do Betha para capturar os
// headers de autenticação que o SPA já envia. Não tem acesso a chrome.* (ver
// content/bridge.js, que repassa ao service worker). Padrão adaptado do
// Delta Intelligence (browser-extension/src/page/interceptor.js), restrito
// só ao Betha Contratos.
;(function () {
  function isBethaContratosApi(url) {
    try {
      const u = new URL(url, window.location.href)
      return u.hostname === 'api.contratos.betha.cloud'
    } catch {
      return false
    }
  }

  function extrairAuth(headers) {
    const auth = headers['authorization'] || ''
    const appContext = headers['app-context'] || headers['app_context'] || ''
    const userAccess = headers['user-access'] || headers['user_access'] || headers['useraccess'] || ''
    if (auth && appContext && userAccess) return { authorization: auth, appContext, userAccess }
    return null
  }

  function despachar(headers) {
    const auth = extrairAuth(headers)
    if (!auth) return
    window.postMessage({ __centralDadosType: 'headers-capturados', headers: auth }, '*')
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
    if (isBethaContratosApi(url)) {
      despachar(headersDeFetchInit(init))
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
    if (this.__cd_url && isBethaContratosApi(this.__cd_url)) {
      despachar(this.__cd_headers || {})
    }
    return originalSend.apply(this, arguments)
  }
})()
