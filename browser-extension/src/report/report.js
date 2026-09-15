import { montarCamposRelatorio, montarSecoesAditivos } from '../shared/campos-relatorio.js'

const STORAGE_KEY = 'centralDados.relatorioAtual'

async function carregar() {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const contrato = stored[STORAGE_KEY]

  if (!contrato) {
    document.getElementById('vazio').hidden = false
    document.getElementById('imprimir').disabled = true
    return
  }

  const tabela = document.getElementById('tabela')
  for (const { label, valor } of montarCamposRelatorio(contrato)) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td class="campo"></td><td class="valor"></td>`
    tr.querySelector('.campo').textContent = label
    tr.querySelector('.valor').textContent = valor || '—'
    tabela.appendChild(tr)
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

      const tabelaAditivo = document.createElement('table')
      for (const { label, valor } of secao.campos) {
        const tr = document.createElement('tr')
        tr.innerHTML = `<td class="campo"></td><td class="valor"></td>`
        tr.querySelector('.campo').textContent = label
        tr.querySelector('.valor').textContent = valor || '—'
        tabelaAditivo.appendChild(tr)
      }
      bloco.appendChild(tabelaAditivo)
      container.appendChild(bloco)
    }
  }

  // Consumido uma vez — evita reabrir a mesma aba (ex.: F5) mostrando dados de
  // um relatório antigo por engano.
  await chrome.storage.local.remove(STORAGE_KEY)
}

document.getElementById('imprimir').addEventListener('click', () => window.print())

carregar()
