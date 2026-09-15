import { montarCamposRelatorio, montarSecoesAditivos, montarTabelaItens } from '../shared/campos-relatorio.js'

const STORAGE_KEY = 'centralDados.relatorioAtual'

function criarTabelaCampos(campos) {
  const tabela = document.createElement('table')
  for (const { label, valor } of campos) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td class="campo"></td><td class="valor"></td>`
    tr.querySelector('.campo').textContent = label
    tr.querySelector('.valor').textContent = valor || '—'
    tabela.appendChild(tr)
  }
  return tabela
}

// Tabela de colunas dinâmicas (itens do contrato ou de um aditivo) — null se
// não houver nenhuma linha (chamador decide o que mostrar nesse caso).
function criarTabelaDinamica({ colunas, linhas }) {
  if (!linhas.length) return null

  const tabela = document.createElement('table')
  tabela.className = 'tabela-itens'

  const thead = document.createElement('thead')
  const trCabecalho = document.createElement('tr')
  for (const coluna of colunas) {
    const th = document.createElement('th')
    th.textContent = coluna
    trCabecalho.appendChild(th)
  }
  thead.appendChild(trCabecalho)
  tabela.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const linha of linhas) {
    const tr = document.createElement('tr')
    for (const valor of linha) {
      const td = document.createElement('td')
      td.textContent = valor || '—'
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }
  tabela.appendChild(tbody)

  return tabela
}

async function carregar() {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const contrato = stored[STORAGE_KEY]

  if (!contrato) {
    document.getElementById('vazio').hidden = false
    document.getElementById('imprimir').disabled = true
    return
  }

  document.getElementById('tabela').replaceWith(criarTabelaCampos(montarCamposRelatorio(contrato)))

  // Itens do contrato — logo abaixo dos dados do contrato.
  const containerItensContrato = document.getElementById('itensContrato')
  const tabelaItensContrato = criarTabelaDinamica(montarTabelaItens(contrato.itens))
  if (tabelaItensContrato) {
    const titulo = document.createElement('h2')
    titulo.textContent = `Itens do contrato (${contrato.itens.length})`
    containerItensContrato.appendChild(titulo)
    containerItensContrato.appendChild(tabelaItensContrato)
  }

  const secoesAditivos = montarSecoesAditivos(contrato.aditivos)
  if (secoesAditivos.length) {
    const container = document.getElementById('aditivos')
    const titulo = document.createElement('h2')
    titulo.textContent = `Aditivos (${secoesAditivos.length})`
    container.appendChild(titulo)

    for (const secao of secoesAditivos) {
      const bloco = document.createElement('div')
      bloco.className = 'aditivo-secao'

      const h3 = document.createElement('h3')
      h3.textContent = secao.titulo
      bloco.appendChild(h3)
      bloco.appendChild(criarTabelaCampos(secao.campos))

      // Itens vinculados a ESTE aditivo, logo abaixo dos dados dele — ou a
      // mensagem explícita de que não há nenhum (aditivo sem itens é um
      // estado normal, não um erro).
      const tabelaItensAditivo = criarTabelaDinamica(secao.tabelaItens)
      if (tabelaItensAditivo) {
        bloco.appendChild(tabelaItensAditivo)
      } else {
        const semItens = document.createElement('p')
        semItens.className = 'sem-itens'
        semItens.textContent = `Aditivo ${secao.numero} sem itens vinculados`
        bloco.appendChild(semItens)
      }

      container.appendChild(bloco)
    }
  }

  // Consumido uma vez — evita reabrir a mesma aba (ex.: F5) mostrando dados de
  // um relatório antigo por engano.
  await chrome.storage.local.remove(STORAGE_KEY)
}

document.getElementById('imprimir').addEventListener('click', () => window.print())

carregar()
