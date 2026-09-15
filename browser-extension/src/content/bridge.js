// Roda no mundo ISOLATED - compartilha o DOM com o interceptor.js (MAIN) para
// receber o postMessage, e tem acesso a chrome.runtime para repassar ao
// service worker.
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.__centralDadosType === 'headers-capturados') {
    chrome.runtime.sendMessage({ type: 'headers-capturados', headers: data.headers }).catch(() => {})
  }
})
