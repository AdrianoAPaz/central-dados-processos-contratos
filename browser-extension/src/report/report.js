import {
  montarCamposRelatorio,
  montarSecoesAditivos,
  montarTabelaItens,
  montarTabelaResponsaveis,
  montarSecoesSolicitacoesFornecimento,
  montarSecoesInteracoesContabilidade,
  montarSecoesRecebimentos,
  montarDocumentoPublicacoes,
  MENSAGEM_SEM_RESPONSAVEIS,
} from '../shared/campos-relatorio.js'
import { criarZip } from '../shared/zip.js'
import { listarDocumentosRelatorio } from '../shared/pdf-relatorio.js'
import { criarTabelaCampos, criarTabelaDinamica } from '../shared/dom-relatorio.js'
import { baixarBlob, coletarArquivosPacote } from '../shared/pacote.js'
import { coletarAnexosContrato, nomeArquivoZipContrato, pastaAnexosContrato } from '../shared/pacote-contrato.js'

const STORAGE_KEY = 'centralDados.relatorioAtual'

// Gera o PDF do relatório e baixa cada anexo via service worker (que tem a
// sessão do Betha), agrupando tudo num único .zip (pedido do usuário — em
// vez de um download separado por arquivo). Um PDF por documento (contrato,
// cada aditivo, cada solicitação de fornecimento) — pedido do usuário:
// relatórios separados, não um único PDF juntando tudo.
async function montarPacoteRelatorio(contrato, anexos, container) {
  const titulo = document.createElement('h2')
  titulo.textContent = 'Anexos e relatório em PDF'
  container.appendChild(titulo)

  const lista = document.createElement('ul')
  lista.className = 'lista-anexos'
  container.appendChild(lista)

  const baixados = await coletarArquivosPacote({
    documentos: listarDocumentosRelatorio(contrato),
    anexos,
    pasta: pastaAnexosContrato(contrato),
    lista,
  })
  if (!baixados.length) return

  const nomeZip = nomeArquivoZipContrato(contrato)
  baixarBlob(criarZip(baixados), nomeZip)

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
  // Aparece sempre — sem responsáveis, com o mesmo aviso do documento.
  const tabelaResponsaveis = criarTabelaDinamica(montarTabelaResponsaveis(contrato.responsaveis))
  const tituloResponsaveis = document.createElement('h2')
  tituloResponsaveis.textContent = `Responsáveis (${(contrato.responsaveis || []).length})`
  containerResponsaveis.appendChild(tituloResponsaveis)
  if (tabelaResponsaveis) {
    containerResponsaveis.appendChild(tabelaResponsaveis)
  } else {
    const semResponsaveis = document.createElement('p')
    semResponsaveis.className = 'sem-itens'
    semResponsaveis.textContent = MENSAGEM_SEM_RESPONSAVEIS
    containerResponsaveis.appendChild(semResponsaveis)
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

      // Itens vinculados a ESTA solicitação, logo abaixo dos dados dela — ou
      // a mensagem explícita de que não há nenhum (mesmo estilo dos aditivos).
      const tabelaItensSf = criarTabelaDinamica(secao.tabelaItens)
      if (tabelaItensSf) {
        bloco.appendChild(tabelaItensSf)
      } else {
        const semItens = document.createElement('p')
        semItens.className = 'sem-itens'
        semItens.textContent = `${secao.titulo} sem itens vinculados`
        bloco.appendChild(semItens)
      }

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

  // Publicações do contrato — mesmo conteúdo do documento "publicação
  // contrato X"; a seção aparece sempre, com o aviso quando não há nenhuma.
  const documentoPublicacoes = montarDocumentoPublicacoes(contrato)
  const containerPublicacoes = document.getElementById('publicacoes')
  const tituloPublicacoes = document.createElement('h2')
  tituloPublicacoes.textContent = `Publicações (${documentoPublicacoes.blocos.length})`
  containerPublicacoes.appendChild(tituloPublicacoes)

  if (!documentoPublicacoes.blocos.length) {
    const semPublicacoes = document.createElement('p')
    semPublicacoes.className = 'sem-itens'
    semPublicacoes.textContent = 'Sem publicações cadastradas'
    containerPublicacoes.appendChild(semPublicacoes)
  }
  for (const bloco of documentoPublicacoes.blocos) {
    const div = document.createElement('div')
    div.className = 'aditivo-secao'
    const h3 = document.createElement('h3')
    h3.textContent = bloco.titulo
    div.appendChild(h3)
    div.appendChild(criarTabelaCampos(bloco.campos))
    containerPublicacoes.appendChild(div)
  }

  // Gera o PDF do relatório e baixa os anexos automaticamente ao abrir a
  // aba, agrupando tudo num único .zip — pedido do usuário: não precisa de
  // clique extra nem de downloads separados.
  await montarPacoteRelatorio(contrato, coletarAnexosContrato(contrato), document.getElementById('anexos'))

  // Consumido uma vez — evita reabrir a mesma aba (ex.: F5) mostrando dados de
  // um relatório antigo por engano.
  await chrome.storage.local.remove(STORAGE_KEY)
}

document.getElementById('imprimir').addEventListener('click', () => window.print())

carregar()
