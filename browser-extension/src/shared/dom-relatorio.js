// Tabelas HTML usadas na pré-visualização dos relatórios (report/report.js —
// contratos — e report/processo.js — processos administrativos).

export function criarTabelaCampos(campos) {
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
export function criarTabelaDinamica({ colunas, linhas }) {
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
