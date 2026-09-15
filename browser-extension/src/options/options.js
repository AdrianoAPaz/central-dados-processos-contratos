const STORAGE_KEY = 'centralDados.backendUrl'
const input = document.getElementById('backendUrl')
const msgEl = document.getElementById('msg')

chrome.storage.local.get(STORAGE_KEY).then((stored) => {
  input.value = stored[STORAGE_KEY] || ''
})

document.getElementById('salvar').addEventListener('click', async () => {
  const url = input.value.trim().replace(/\/$/, '')
  if (!url) {
    msgEl.textContent = 'Informe uma URL.'
    return
  }

  let origin
  try {
    origin = new URL(url).origin
  } catch {
    msgEl.textContent = 'URL inválida.'
    return
  }

  const concedido = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!concedido) {
    msgEl.textContent = 'Permissão negada - a extensão não pode enviar dados para essa URL sem ela.'
    return
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: url })
  msgEl.textContent = 'Salvo.'
})
