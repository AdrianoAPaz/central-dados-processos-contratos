import {
  montarCamposRelatorio,
  montarSecoesAditivos,
  montarTabelaItens,
  montarSecoesSolicitacoesFornecimento,
} from '../shared/campos-relatorio.js'
import { criarZip } from '../shared/zip.js'
import { gerarPdfRelatorio } from '../shared/pdf-relatorio.js'

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

// Anexos do contrato — `arquivos` é um array inline do próprio registro
// (contrato e cada aditivo podem trazer o seu), nunca um sub-recurso à
// parte; por isso já vêm dentro de `contrato` sem precisar de outra busca.
// Confirmado no projeto irmão Delta Intelligence (CONTEXTO_PROJETO.md §5).
function coletarAnexos(contrato) {
  const doContrato = (Array.isArray(contrato.arquivos) ? contrato.arquivos : []).map((a) => ({ ...a, origem: 'Contrato' }))
  const doAditivos = (Array.isArray(contrato.aditivos) ? contrato.aditivos : []).flatMap((aditivo, i) =>
    (Array.isArray(aditivo.arquivos) ? aditivo.arquivos : []).map((a) => ({ ...a, origem: `Aditivo ${i + 1}` })),
  )
  return [...doContrato, ...doAditivos].filter((a) => a && a.id)
}

function nomeAnexo(a) {
  return a.nome || a.nomeArquivo || a.descricao || a.titulo || 'Anexo'
}

// Evita colisão de nome dentro do zip (dois anexos "edital.pdf" — um do
// contrato, outro de um aditivo — sobrescreveriam um ao outro na extração
// sem isto). Mantém o nome original na 1ª ocorrência.
function nomeUnicoNoZip(nome, usados) {
  if (!usados.has(nome)) {
    usados.add(nome)
    return nome
  }
  const pontoFinal = nome.lastIndexOf('.')
  const base = pontoFinal > 0 ? nome.slice(0, pontoFinal) : nome
  const extensao = pontoFinal > 0 ? nome.slice(pontoFinal) : ''
  let n = 2
  let candidato = `${base} (${n})${extensao}`
  while (usados.has(candidato)) {
    n += 1
    candidato = `${base} (${n})${extensao}`
  }
  usados.add(candidato)
  return candidato
}

function nomeArquivoZip(contrato) {
  const numero = contrato.numeroTermo != null
    ? (contrato.ano ? `${contrato.numeroTermo}-${contrato.ano}` : String(contrato.numeroTermo))
    : `seq-${contrato.sequencial ?? 'contrato'}`
  return `anexos-contrato-${numero}.zip`
}

// Gera o PDF do relatório e baixa cada anexo via service worker (que tem a
// sessão do Betha), agrupando tudo num único .zip (pedido do usuário — em
// vez de um download separado por arquivo). Anexos sequenciais, não em
// paralelo: rajada de requisições autenticadas de uma vez arrisca
// rate-limit oculto no Betha (mesma cautela do Delta Intelligence para
// POSTs em sequência).
async function montarPacoteRelatorio(contrato, anexos, container) {
  const titulo = document.createElement('h2')
  titulo.textContent = 'Anexos e relatório em PDF'
  container.appendChild(titulo)

  const lista = document.createElement('ul')
  lista.className = 'lista-anexos'
  container.appendChild(lista)

  const usados = new Set()
  const baixados = []

  const liPdf = document.createElement('li')
  liPdf.textContent = '⏳ Relatório do contrato (PDF)'
  lista.appendChild(liPdf)
  try {
    const pdfBlob = gerarPdfRelatorio(contrato)
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer())
    baixados.push({ nome: nomeUnicoNoZip('relatorio-contrato.pdf', usados), bytes: pdfBytes })
    liPdf.textContent = '✅ Relatório do contrato (PDF)'
  } catch (e) {
    liPdf.textContent = `⚠️ Relatório do contrato (PDF) — erro: ${String((e && e.message) || e)}`
  }

  for (const anexo of anexos) {
    const li = document.createElement('li')
    li.textContent = `⏳ ${anexo.origem} — ${nomeAnexo(anexo)}`
    lista.appendChild(li)

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'baixar-anexo', arquivoId: anexo.id })
      if (!resp || resp.erro || resp.success !== true || typeof resp.base64 !== 'string') {
        li.textContent = `⚠️ ${anexo.origem} — ${nomeAnexo(anexo)} (falha: ${(resp && resp.erro) || 'sem retorno'})`
        continue
      }
      const bin = atob(resp.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      baixados.push({ nome: nomeUnicoNoZip(nomeAnexo(anexo), usados), bytes })
      li.textContent = `✅ ${anexo.origem} — ${nomeAnexo(anexo)}`
    } catch (e) {
      li.textContent = `⚠️ ${anexo.origem} — ${nomeAnexo(anexo)} (erro: ${String((e && e.message) || e)})`
    }
  }

  if (!baixados.length) return

  const nomeZip = nomeArquivoZip(contrato)
  const zipBlob = criarZip(baixados)
  const objectUrl = URL.createObjectURL(zipBlob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = nomeZip
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)

  const resumo = document.createElement('p')
  resumo.className = 'sem-itens'
  resumo.textContent = `${baixados.length} arquivo(s) agrupado(s) em ${nomeZip}`
  container.appendChild(resumo)
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

  // Solicitações de fornecimento vinculadas ao contrato — cada uma com TODOS
  // os campos que a API devolveu (pedido do usuário: "todas as
  // informações"), no mesmo estilo de seção dos aditivos.
  const secoesSf = montarSecoesSolicitacoesFornecimento(contrato.solicitacoesFornecimento)
  if (secoesSf.length) {
    const container = document.getElementById('solicitacoesFornecimento')
    const titulo = document.createElement('h2')
    titulo.textContent = `Solicitações de fornecimento (${secoesSf.length})`
    container.appendChild(titulo)

    for (const secao of secoesSf) {
      const bloco = document.createElement('div')
      bloco.className = 'aditivo-secao'

      const h3 = document.createElement('h3')
      h3.textContent = secao.titulo
      bloco.appendChild(h3)
      bloco.appendChild(criarTabelaCampos(secao.campos))

      container.appendChild(bloco)
    }
  }

  // Gera o PDF do relatório e baixa os anexos automaticamente ao abrir a
  // aba, agrupando tudo num único .zip — pedido do usuário: não precisa de
  // clique extra nem de downloads separados.
  await montarPacoteRelatorio(contrato, coletarAnexos(contrato), document.getElementById('anexos'))

  // Consumido uma vez — evita reabrir a mesma aba (ex.: F5) mostrando dados de
  // um relatório antigo por engano.
  await chrome.storage.local.remove(STORAGE_KEY)
}

document.getElementById('imprimir').addEventListener('click', () => window.print())

carregar()
