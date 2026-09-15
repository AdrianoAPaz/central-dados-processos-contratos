// Injeta um ícone "Central de Dados" no grupo de ícones do lado direito da
// barra de menu do Betha Contratos (mesmo grupo de notificações/ajuda) — ao
// invés de um item de texto entre os menus principais. Seletor + heurística
// de layout adaptados do menu-injector.js do Delta Intelligence (já em
// produção contra essa mesma UI).
const MENU_LABEL = 'Central de Dados'
const MENU_SELECTOR = 'ul.megamenu, nav [role="menubar"], [class*="megamenu"]'

// Ícone de "relatório/documento" — simples, neutro, sem depender da fonte de
// ícones própria do Betha (desconhecida). Herda a cor do botão-irmão via
// `currentColor` (ver espelharLayoutDoIrmao).
const ICONE_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 19.5V4.5A2 2 0 0 1 6 2.5h8l4 4v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>
    <path d="M14 2.5V7h4"/>
    <path d="M8 13h8M8 17h5"/>
  </svg>
`

const CONHECIDOS = [
  'visão geral', 'visao geral',
  'configurando',
  'administrando',
  'processando',
  'contratando',
  'executando',
]

function normalizar(texto) {
  return texto.toLowerCase().replace(/\s+/g, ' ').trim()
}

function contarConhecidos(el) {
  let count = 0
  const links = el.querySelectorAll('a, button, span, li')
  for (const link of links) {
    if (CONHECIDOS.includes(normalizar(link.textContent || ''))) count++
  }
  return count
}

function encontrarMenu() {
  const ulDireta = document.querySelector('ul.megamenu')
  if (ulDireta && contarConhecidos(ulDireta) >= 3) return ulDireta

  const elementos = document.querySelectorAll(MENU_SELECTOR)
  for (const el of elementos) {
    if (contarConhecidos(el) < 3) continue
    if (el.tagName === 'UL') return el
    const innerUl = el.querySelector('ul.megamenu') || el.querySelector('ul')
    return innerUl || el
  }
  return null
}

function ehItemDireita(li) {
  if (/menu-right|notification|pull-right|navbar-right/i.test(li.className)) return true
  try {
    return getComputedStyle(li).cssFloat === 'right'
  } catch {
    return false
  }
}

// Decide onde inserir o novo <li> e de qual <li> irmão copiar o layout.
// Preferência: juntar-se ao grupo de ícones da direita (mesmo visual de
// notificações/ajuda) — só cai para o texto do menu principal se não achar
// nenhum ícone à direita (heurística defensiva, Betha pode mudar o layout).
function encontrarPontoInsercao(ul) {
  const itens = [...ul.children].filter((el) => el.tagName === 'LI')

  const direita = itens.find(ehItemDireita)
  if (direita) return { ref: direita, doador: direita }

  let ultimoConhecido = null
  for (const li of itens) {
    const a = li.querySelector(':scope > a')
    if (a && CONHECIDOS.includes(normalizar(a.textContent || ''))) ultimoConhecido = li
  }
  if (ultimoConhecido) return { ref: ultimoConhecido.nextElementSibling, doador: ultimoConhecido }

  return { ref: null, doador: null }
}

function espelharLayoutDoIrmao(li, ul, doadorPreferido) {
  const doador =
    doadorPreferido ||
    [...ul.children].find((el) => el !== li && el.tagName === 'LI' && !/menu-right/i.test(el.className))

  if (!doador) return
  try {
    const cs = getComputedStyle(doador)
    li.style.setProperty('display', cs.display, 'important')
    li.style.setProperty('float', cs.cssFloat, 'important')
    li.style.setProperty('vertical-align', cs.verticalAlign, 'important')
    li.style.setProperty('height', cs.height, 'important')
    li.style.setProperty('line-height', cs.lineHeight, 'important')
    li.style.setProperty('margin', cs.margin, 'important')
    li.style.setProperty('padding', cs.padding, 'important')
    li.style.setProperty('box-sizing', cs.boxSizing, 'important')
    li.style.setProperty('width', 'auto', 'important')

    const aDoador = doador.querySelector(':scope > a') || doador
    const aNosso = li.querySelector(':scope > a')
    if (aDoador && aNosso) {
      const csA = getComputedStyle(aDoador)
      aNosso.style.setProperty('display', 'inline-flex', 'important')
      aNosso.style.setProperty('align-items', 'center', 'important')
      aNosso.style.setProperty('justify-content', 'center', 'important')
      aNosso.style.setProperty('height', csA.height, 'important')
      aNosso.style.setProperty('padding', csA.padding, 'important')
      aNosso.style.setProperty('margin', csA.margin, 'important')
      aNosso.style.setProperty('color', csA.color, 'important')
      aNosso.style.setProperty('text-decoration', 'none', 'important')
    }
  } catch {}
}

function abrirPainel() {
  window.dispatchEvent(new CustomEvent('central-dados-abrir-painel'))
}

function injetarMenu() {
  const menuContainer = encontrarMenu()
  if (!menuContainer) return false
  if (document.getElementById('central-dados-menu-item')) return true

  const menuItem = document.createElement('a')
  menuItem.id = 'central-dados-menu-item'
  menuItem.className = 'central-dados-menu-item drop'
  menuItem.href = '#'
  menuItem.title = MENU_LABEL
  menuItem.setAttribute('aria-label', MENU_LABEL)
  menuItem.setAttribute('role', 'menuitem')
  menuItem.setAttribute('tabindex', '0')
  menuItem.innerHTML = ICONE_SVG

  if (menuContainer.tagName === 'UL') {
    const li = document.createElement('li')
    li.className = 'central-dados-menu-wrapper'
    li.appendChild(menuItem)
    const { ref, doador } = encontrarPontoInsercao(menuContainer)
    if (ref) menuContainer.insertBefore(li, ref)
    else menuContainer.appendChild(li)
    espelharLayoutDoIrmao(li, menuContainer, doador)
  } else {
    menuContainer.appendChild(menuItem)
  }

  menuItem.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    abrirPainel()
  })

  menuItem.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      abrirPainel()
    }
  })

  return true
}

function observarMenu() {
  if (injetarMenu()) return

  const observer = new MutationObserver(() => {
    if (injetarMenu()) observer.disconnect()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  setTimeout(() => observer.disconnect(), 30000)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observarMenu)
} else {
  observarMenu()
}
