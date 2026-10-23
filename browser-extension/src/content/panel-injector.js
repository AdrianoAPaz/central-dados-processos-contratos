// Cria/abre/fecha um painel (iframe com o próprio popup.html da extensão)
// sobreposto à página do Betha Contratos, disparado pelo clique no item de
// menu injetado por menu-injector.js.
const PANEL_ID = 'central-dados-panel-overlay'
const IFRAME_ID = 'central-dados-panel-iframe'

function criarPainel() {
  const existente = document.getElementById(PANEL_ID)
  if (existente) {
    existente.style.display = 'flex'
    return
  }

  const overlay = document.createElement('div')
  overlay.id = PANEL_ID
  overlay.className = 'central-dados-panel-overlay'

  const caixa = document.createElement('div')
  caixa.className = 'central-dados-panel-caixa'

  const fechar = document.createElement('button')
  fechar.className = 'central-dados-panel-fechar'
  fechar.textContent = '✕'
  fechar.title = 'Fechar'
  fechar.addEventListener('click', fecharPainel)

  const iframe = document.createElement('iframe')
  iframe.id = IFRAME_ID
  iframe.className = 'central-dados-panel-iframe'
  iframe.src = chrome.runtime.getURL('src/popup/popup.html')
  // allow-popups: o botão "Gerar PDF" do popup abre uma aba nova
  // (chrome.tabs.create) — sem isso, o Chrome bloqueia silenciosamente.
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups')

  caixa.appendChild(fechar)
  caixa.appendChild(iframe)
  overlay.appendChild(caixa)
  document.body.appendChild(overlay)

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) fecharPainel()
  })
}

function fecharPainel() {
  const overlay = document.getElementById(PANEL_ID)
  if (overlay) overlay.style.display = 'none'
}

window.addEventListener('central-dados-abrir-painel', criarPainel)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharPainel()
})
