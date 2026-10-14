import {
  montarCamposRelatorio,
  montarSecoesAditivos,
  montarTabelaItens,
  montarTabelaResponsaveis,
  montarSecoesSolicitacoesFornecimento,
  montarSecoesInteracoesContabilidade,
  montarSecoesRecebimentos,
} from '../shared/campos-relatorio.js'
import { criarZip } from '../shared/zip.js'
import { listarDocumentosRelatorio } from '../shared/pdf-relatorio.js'

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
  // Documentos das janelas "Textos" e "Publicação" do contrato — buscados à
  // parte (não vêm no campo inline `arquivos`, ver service-worker.js).
  const doTextos = (Array.isArray(contrato.anexosTextos) ? contrato.anexosTextos : []).map((a) => ({ ...a, origem: 'Textos' }))
  const daPublicacao = (Array.isArray(contrato.anexosPublicacao) ? contrato.anexosPublicacao : []).map((a) => ({ ...a, origem: 'Publicação' }))
  return [...doContrato, ...doAditivos, ...doTextos, ...daPublicacao].filter((a) => a && a.id)
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

function numeroContrato(contrato) {
  return contrato.numeroTermo != null
    ? (contrato.ano ? `${contrato.numeroTermo}-${contrato.ano}` : String(contrato.numeroTermo))
    : `seq-${contrato.sequencial ?? 'contrato'}`
}

function nomeArquivoZip(contrato) {
  return `anexos-contrato-${numeroContrato(contrato)}.zip`
}

// Pasta dentro do zip que agrupa todos os anexos baixados — pedido do
// usuário para separar melhor os documentos de cada contrato.
function pastaAnexosNoZip(contrato) {
  return `Anexos do contrato numero ${numeroContrato(contrato)}`
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
  const pasta = pastaAnexosNoZip(contrato)

  // Um PDF por documento (contrato, cada aditivo, cada solicitação de
  // fornecimento) — pedido do usuário: relatórios separados, não um único
  // PDF juntando tudo. Cada um gera e falha independente dos demais.
  for (const documento of listarDocumentosRelatorio(contrato)) {
    const li = document.createElement('li')
    li.textContent = `⏳ ${documento.nome}`
    lista.appendChild(li)
    try {
      const pdfBlob = documento.gerar()
      const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer())
      baixados.push({ nome: nomeUnicoNoZip(documento.nome, usados), bytes: pdfBytes })
      li.textContent = `✅ ${documento.nome}`
    } catch (e) {
      li.textContent = `⚠️ ${documento.nome} — erro: ${String((e && e.message) || e)}`
    }
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
      baixados.push({ nome: `${pasta}/${nomeUnicoNoZip(nomeAnexo(anexo), usados)}`, bytes })
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

  // Responsáveis do contrato (fiscal, gestor etc.) — seção própria com nome,
  // tipo e período de cada um, em vez de um campo único na tabela principal.
  const containerResponsaveis = document.getElementById('responsaveis')
  const tabelaResponsaveis = criarTabelaDinamica(montarTabelaResponsaveis(contrato.responsaveis))
  if (tabelaResponsaveis) {
    const titulo = document.createElement('h2')
    titulo.textContent = `Responsáveis (${contrato.responsaveis.length})`
    containerResponsaveis.appendChild(titulo)
    containerResponsaveis.appendChild(tabelaResponsaveis)
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

  // Interações contábeis (empenhar/liquidar/pagar) vinculadas ao contrato —
  // mesmo estilo de seção das solicitações de fornecimento.
  const secoesInteracoes = montarSecoesInteracoesContabilidade(contrato.interacoesContabilidade)
  if (secoesInteracoes.length) {
    const container = document.getElementById('interacoesContabilidade')
    const titulo = document.createElement('h2')
    titulo.textContent = `Interações contábeis (${secoesInteracoes.length})`
    container.appendChild(titulo)

    for (const secao of secoesInteracoes) {
      const bloco = document.createElement('div')
      bloco.className = 'aditivo-secao'

      const h3 = document.createElement('h3')
      h3.textContent = secao.titulo
      bloco.appendChild(h3)
      bloco.appendChild(criarTabelaCampos(secao.campos))

      container.appendChild(bloco)
    }
  }

  // Recebimentos de cada solicitação de fornecimento — aba própria, separada
  // da seção de solicitações (pedido do usuário, 2026-09-17). Cada
  // solicitação que tem recebimento vira uma subseção, e CADA recebimento
  // dentro dela é seu próprio bloco com TODOS os campos (pedido do usuário:
  // a tela "Editando recebimento" do Betha tem bem mais informação que a
  // listagem — desconto, retenção tributária, provisório, observações,
  // comprovantes).
  const secoesRecebimentos = montarSecoesRecebimentos(contrato.solicitacoesFornecimento)
  if (secoesRecebimentos.length) {
    const container = document.getElementById('recebimentos')
    const totalRecebimentos = secoesRecebimentos.reduce((total, s) => total + s.recebimentos.length, 0)
    const titulo = document.createElement('h2')
    titulo.textContent = `Recebimentos (${totalRecebimentos})`
    container.appendChild(titulo)

    for (const secaoSf of secoesRecebimentos) {
      const blocoSf = document.createElement('div')
      blocoSf.className = 'aditivo-secao'

      const h3 = document.createElement('h3')
      h3.textContent = secaoSf.titulo
      blocoSf.appendChild(h3)

      for (const recebimento of secaoSf.recebimentos) {
        const h4 = document.createElement('h4')
        h4.textContent = recebimento.titulo
        blocoSf.appendChild(h4)
        blocoSf.appendChild(criarTabelaCampos(recebimento.campos))

        // Itens efetivamente recebidos (do catálogo da solicitação) — logo
        // abaixo dos campos deste recebimento, ou a mensagem explícita de
        // que não há nenhum.
        const tabelaItensRecebimento = criarTabelaDinamica(recebimento.tabelaItens)
        if (tabelaItensRecebimento) {
          blocoSf.appendChild(tabelaItensRecebimento)
        } else {
          const semItens = document.createElement('p')
          semItens.className = 'sem-itens'
          semItens.textContent = `${recebimento.titulo} sem itens vinculados`
          blocoSf.appendChild(semItens)
        }
      }

      container.appendChild(blocoSf)
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
