// Roda no mundo ISOLATED - compartilha o DOM com o interceptor.js (MAIN) para
// receber o postMessage, e tem acesso a chrome.runtime para repassar ao
// service worker. `sistema` ('contratos' | 'compras') diz de qual Betha veio a
// sessão; `apiOrigin`/`apiBasePath` só vêm do Compras (ver interceptor.js).
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.__centralDadosType === 'headers-capturados') {
    chrome.runtime
      .sendMessage({
        type: 'headers-capturados',
        sistema: data.sistema,
        headers: data.headers,
        apiOrigin: data.apiOrigin,
        apiBasePath: data.apiBasePath,
      })
      .catch(() => {})
  }
})
