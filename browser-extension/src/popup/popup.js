const statusEl = document.getElementById('status')
const statusTextoEl = document.getElementById('statusTexto')
const resultadoEl = document.getElementById('resultado')
const msgEl = document.getElementById('msg')
const buscarBtn = document.getElementById('buscar')
const buscarIconeEl = document.getElementById('buscarIcone')
const buscarTextoEl = document.getElementById('buscarTexto')

const ICONE_ENVIAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>`
const ICONE_PDF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>`
const ICONE_BUSCA = buscarIconeEl.innerHTML
const ICONE_SPINNER = '<span class="spinner"></span>'

function mostrarMsg(texto, tipo) {
  msgEl.textContent = texto || ''
  msgEl.className = `msg ${tipo || ''}`
}

async function atualizarStatus() {
  const resp = await chrome.runtime.sendMessage({ type: 'status' })
  if (resp && resp.conectado) {
    statusEl.className = 'status ok'
    statusTextoEl.textContent = 'Conectado à sessão do Betha Contratos'
  } else {
    statusEl.className = 'status erro'
    statusTextoEl.textContent = 'Sessão não capturada — abra contratos.betha.cloud e faça login'
  }
}

function renderCandidatos(lista) {
  resultadoEl.innerHTML = ''
  if (!lista.length) {
    resultadoEl.innerHTML = '<p class="vazio">Nenhum contrato encontrado.</p>'
    return
  }
  for (const c of lista) {
    const numero = c.numeroTermo != null
      ? (c.ano ? `${c.numeroTermo}/${c.ano}` : String(c.numeroTermo))
      : `Seq. ${c.sequencial}`
    const tipo = (c.tipoInstrumento && c.tipoInstrumento.descricao) || ''
    const fornecedor = (c.fornecedor && c.fornecedor.pessoa && c.fornecedor.pessoa.nome) || 'Fornecedor não informado'
    const situacao = c.situacaoDesc || c.situacao || ''

    const div = document.createElement('div')
    div.className = 'candidato'
    div.innerHTML = `
      <div class="titulo">
        <span class="numero">${numero}</span>
        ${situacao ? `<span class="badge">${situacao}</span>` : ''}
      </div>
      <div class="subtitulo">${[tipo, fornecedor].filter(Boolean).join(' · ')}</div>
      <div class="acoes"></div>
    `

    const acoes = div.querySelector('.acoes')

    const btnEnviar = document.createElement('button')
    btnEnviar.className = 'btn btn-secundario'
    btnEnviar.innerHTML = `${ICONE_ENVIAR}<span>Enviar</span>`
    btnEnviar.addEventListener('click', () => enviar(c, btnEnviar))
    acoes.appendChild(btnEnviar)

    const btnPdf = document.createElement('button')
    btnPdf.className = 'btn btn-secundario'
    btnPdf.innerHTML = `${ICONE_PDF}<span>Gerar PDF</span>`
    btnPdf.addEventListener('click', () => gerarPdf(c, btnPdf))
    acoes.appendChild(btnPdf)

    resultadoEl.appendChild(div)
  }
}

// Aditivos, itens e solicitações de fornecimento são sub-recursos
// (contratacoes/{id}/aditivos, contratacoes/{id}/itens,
// contratacoes/{id}/solicitacoesfornecimento/...) — não vêm na busca inicial.
// Busca só quando o usuário efetivamente age sobre UM contrato (enviar/gerar
// PDF), evitando N+1 requisições pra cada candidato da lista. Itens de cada
// aditivo (se existirem) vêm aninhados dentro do próprio aditivo.
async function comDetalhes(contrato) {
  if (contrato.id == null) return contrato

  const [respAditivos, respItens, respSf] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'buscar-aditivos', id: contrato.id }),
    chrome.runtime.sendMessage({ type: 'buscar-itens', id: contrato.id }),
    chrome.runtime.sendMessage({ type: 'buscar-solicitacoes-fornecimento', id: contrato.id }),
  ])
  if (respAditivos && respAditivos.erro) throw new Error(respAditivos.erro)
  if (respItens && respItens.erro) throw new Error(respItens.erro)
  if (respSf && respSf.erro) throw new Error(respSf.erro)

  const aditivos = respAditivos.aditivos || []
  const aditivosComItens = await Promise.all(
    aditivos.map(async (aditivo) => {
      if (aditivo.id == null) return aditivo
      const resp = await chrome.runtime.sendMessage({
        type: 'buscar-itens-aditivo',
        contratoId: contrato.id,
        aditivoId: aditivo.id,
      })
      return { ...aditivo, itens: (resp && resp.itens) || [] }
    }),
  )

  return {
    ...contrato,
    itens: respItens.itens || [],
    aditivos: aditivosComItens,
    solicitacoesFornecimento: respSf.solicitacoes || [],
  }
}

async function enviar(contrato, botao) {
  mostrarMsg('Buscando aditivos, itens e solicitações de fornecimento…', 'info')
  botao.disabled = true
  try {
    const contratoCompleto = await comDetalhes(contrato)
    mostrarMsg('Enviando…', 'info')
    const resp = await chrome.runtime.sendMessage({ type: 'enviar-para-central', contrato: contratoCompleto })
    if (resp && resp.erro) mostrarMsg(resp.erro, 'erro')
    else mostrarMsg('Enviado com sucesso para a Central de Dados.', 'ok')
  } catch (e) {
    mostrarMsg(String((e && e.message) || e), 'erro')
  } finally {
    botao.disabled = false
  }
}

const CHAVE_RELATORIO = 'centralDados.relatorioAtual'

// Abre a página de relatório (src/report/report.html) numa aba nova — ela lê
// o contrato salvo aqui e monta a tabela; o "Salvar como PDF" usa a função
// nativa de impressão do Chrome, sem precisar de nenhuma biblioteca.
async function gerarPdf(contrato, botao) {
  if (botao) botao.disabled = true
  mostrarMsg('Buscando aditivos, itens e solicitações de fornecimento…', 'info')
  try {
    const contratoCompleto = await comDetalhes(contrato)
    await chrome.storage.local.set({ [CHAVE_RELATORIO]: contratoCompleto })
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/report/report.html') })
    mostrarMsg('', '')
  } catch (e) {
    mostrarMsg(String((e && e.message) || e), 'erro')
  } finally {
    if (botao) botao.disabled = false
  }
}

buscarBtn.addEventListener('click', async () => {
  mostrarMsg('', '')
  resultadoEl.innerHTML = ''
  buscarBtn.disabled = true
  buscarIconeEl.innerHTML = ICONE_SPINNER
  buscarTextoEl.textContent = 'Buscando…'

  const sequencial = document.getElementById('sequencial').value.trim()
  const numeroAno = document.getElementById('numero').value.trim()
  const [numero, ano] = numeroAno.split('/')

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'buscar-contrato', sequencial, numero, ano })
    if (resp && resp.erro) {
      mostrarMsg(resp.erro, 'erro')
      return
    }
    renderCandidatos(resp.candidatos || [])
  } finally {
    buscarIconeEl.innerHTML = ICONE_BUSCA
    buscarTextoEl.textContent = 'Buscar'
    buscarBtn.disabled = false
  }
})

atualizarStatus()
