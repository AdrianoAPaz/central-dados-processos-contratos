const statusEl = document.getElementById('status')
const statusTextoEl = document.getElementById('statusTexto')
const resultadoEl = document.getElementById('resultado')
const msgEl = document.getElementById('msg')
const buscarBtn = document.getElementById('buscar')
const buscarIconeEl = document.getElementById('buscarIcone')
const buscarTextoEl = document.getElementById('buscarTexto')
const statusComprasEl = document.getElementById('statusCompras')
const statusComprasTextoEl = document.getElementById('statusComprasTexto')
const resultadoProcessoEl = document.getElementById('resultadoProcesso')
const opcoesProcessoEl = document.getElementById('opcoesProcesso')
const incluirContratacoesEl = document.getElementById('incluirContratacoes')

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

  if (resp && resp.comprasConectado) {
    statusComprasEl.className = 'status ok'
    statusComprasTextoEl.textContent = resp.comprasExercicio
      ? `Conectado ao Betha Compras Cloud — exercício ${resp.comprasExercicio}`
      : 'Conectado à sessão do Betha Compras Cloud'
  } else {
    statusComprasEl.className = 'status erro'
    statusComprasTextoEl.textContent = 'Sessão não capturada — abra compras.betha.cloud e faça login'
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

// Data usada na consulta de saldo/número da despesa — a `dataReferencia` da
// própria interação contábil, quando existir (mantém a consulta no mesmo
// exercício da despesa), senão a data de hoje.
function dataConsultaDespesa(interacao) {
  const bruta = interacao && interacao.dataReferencia
  const d = bruta ? new Date(bruta) : new Date()
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

// Número da despesa (ex.: 291) só existe atrás de uma chamada extra por
// despesa (`despesa.id` só traz o id interno, não o número exibido nas telas
// do Betha — pedido do usuário, 2026-09-22). Enriquece cada item de
// `desdobramento` de cada interação com `despesa.numero`, uma despesa de
// cada vez (mesma cautela contra rajada de requisições já usada nos outros
// sub-recursos desta extensão) e com cache por id pra não repetir a mesma
// busca quando várias interações rateiam a mesma despesa. Best-effort: se a
// busca de uma despesa falhar, o item fica sem `numero` e o relatório
// simplesmente mostra o campo "Despesa" em branco pra aquele rateio, sem
// travar o restante.
async function enriquecerNumerosDespesa(interacoes) {
  const cache = new Map()

  const resultado = []
  for (const interacao of interacoes) {
    const desdobramentos = Array.isArray(interacao && interacao.desdobramento) ? interacao.desdobramento : null
    if (!desdobramentos || !desdobramentos.length) {
      resultado.push(interacao)
      continue
    }

    const data = dataConsultaDespesa(interacao)
    const desdobramentosEnriquecidos = []
    for (const item of desdobramentos) {
      const despesaId = item && item.despesa && item.despesa.id
      if (despesaId == null) {
        desdobramentosEnriquecidos.push(item)
        continue
      }
      const chaveCache = `${despesaId}|${data}`
      if (!cache.has(chaveCache)) {
        const resp = await chrome.runtime.sendMessage({ type: 'buscar-numero-despesa', despesaId, data })
        cache.set(chaveCache, resp && !resp.erro ? { numero: resp.numero, recurso: resp.recurso } : null)
      }
      const dadosDespesa = cache.get(chaveCache)
      const numero = dadosDespesa && dadosDespesa.numero
      const recurso = dadosDespesa && dadosDespesa.recurso
      const extras = {}
      if (numero != null) extras.numero = numero
      if (recurso != null) extras.recurso = recurso
      desdobramentosEnriquecidos.push(Object.keys(extras).length ? { ...item, despesa: { ...item.despesa, ...extras } } : item)
    }
    resultado.push({ ...interacao, desdobramento: desdobramentosEnriquecidos })
  }
  return resultado
}

// Alguns campos dos registros do Betha (solicitação de fornecimento, aditivo)
// vêm só com o `id` de um cadastro auxiliar, sem a descrição: o "local de
// entrega" vem como objeto com `descricao` nula (pedido do usuário,
// 2026-10-14) e o "tipo de objeto" idem — a descrição (ex.: "Na instituição",
// "Outros Serviços") só existe na listagem do respectivo cadastro. Cada
// resolvedor busca a listagem uma única vez e preenche `descricao` no valor
// do campo (o relatório já mostra `descricao` quando presente). Best-effort:
// se a busca falhar, o campo fica como veio, sem travar o relatório.
const RESOLVEDORES_DESCRICAO = [
  { chave: /^loca(l|is)entrega/i, mensagem: 'buscar-locais-entrega', lista: 'locais' },
  { chave: /^tipoobjeto/i, mensagem: 'buscar-tipos-objeto', lista: 'tipos' },
  { chave: /^formas?pagamento/i, mensagem: 'buscar-formas-pagamento', lista: 'formas' },
  { chave: /^prazos?(de)?entrega/i, mensagem: 'buscar-prazos-entrega', lista: 'prazos' },
]

// Valor do campo pode ser o objeto do cadastro ({ id, ... }) ou só o id.
function idDoValor(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v.id != null ? String(v.id) : null
  if ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\d+$/.test(v))) return String(v)
  return null
}

function chavesParaResolver(registro, resolvedor) {
  return Object.keys(registro || {}).filter((chave) => resolvedor.chave.test(chave) && idDoValor(registro[chave]) != null)
}

async function enriquecerDescricoesCadastros(registros) {
  let resultado = registros
  for (const resolvedor of RESOLVEDORES_DESCRICAO) {
    if (!resultado.some((r) => chavesParaResolver(r, resolvedor).length)) continue

    const resp = await chrome.runtime.sendMessage({ type: resolvedor.mensagem })
    if (!resp || resp.erro) continue
    const descricaoPorId = new Map((resp[resolvedor.lista] || []).map((x) => [String(x.id), x.descricao]))

    resultado = resultado.map((registro) => {
      const enriquecido = { ...registro }
      for (const chave of chavesParaResolver(registro, resolvedor)) {
        const valor = registro[chave]
        const descricao = descricaoPorId.get(idDoValor(valor))
        if (descricao == null) continue
        enriquecido[chave] = typeof valor === 'object' ? { ...valor, descricao } : { id: valor, descricao }
      }
      return enriquecido
    })
  }
  return resultado
}

// Campos de responsável da solicitação de fornecimento (ex.: "Responsável
// autorização/rejeição", `responsavelAutorizacaoRejeicao`) vêm só com o id, sem
// nome (pedido do usuário, 2026-10-19) — o cadastro completo, com
// `pessoa.nome`, está em `responsaveis/paginacao` (ver
// buscarResponsavelContratos no service-worker.js). Valor pode ser o objeto
// ({ id, pessoa: null… }) ou só o id. Uma busca por id, com cache — vários
// registros costumam ter o mesmo responsável. Best-effort: se a busca falhar, o
// campo fica como veio, sem travar o relatório.
async function enriquecerResponsaveis(registros) {
  const cache = new Map()
  const resultado = []
  for (const registro of registros) {
    const enriquecido = { ...registro }
    for (const chave of Object.keys(registro || {})) {
      if (!/^responsavel/i.test(chave)) continue
      const valor = registro[chave]
      const id = idDoValor(valor)
      const jaTemNome = valor && typeof valor === 'object' && (valor.pessoa || valor.nome)
      if (id == null || jaTemNome) continue

      if (!cache.has(id)) {
        const resp = await chrome.runtime.sendMessage({ type: 'buscar-responsavel', id })
        cache.set(id, resp && !resp.erro ? resp.responsavel : null)
      }
      const completo = cache.get(id)
      if (completo) enriquecido[chave] = typeof valor === 'object' ? { ...valor, ...completo } : completo
    }
    resultado.push(enriquecido)
  }
  return resultado
}

// `contratacao` de cada interação contábil (e de cada texto do contrato) só
// traz o id interno da contratação — o relatório mostra o sequencial dela (o mesmo do documento do
// contrato; pedido do usuário, 2026-10-14). Quando o id é o do próprio
// contrato (o caso normal, já que as interações vêm de
// contratacoes/{id}/interacaocontabil) usa o sequencial que já temos; só vai
// ao Betha por id se for outra contratação. Best-effort: se a busca falhar, o
// campo fica em branco, sem travar o relatório.
async function enriquecerSequenciaisContratacao(interacoes, contrato) {
  const cache = new Map()
  if (contrato.id != null && contrato.sequencial != null) cache.set(String(contrato.id), contrato.sequencial)

  const resultado = []
  for (const interacao of interacoes) {
    const contratacao = interacao && interacao.contratacao
    if (!contratacao || typeof contratacao !== 'object' || contratacao.id == null) {
      resultado.push(interacao)
      continue
    }
    const chave = String(contratacao.id)
    if (!cache.has(chave)) {
      const resp = await chrome.runtime.sendMessage({ type: 'buscar-sequencial-contratacao', contratacaoId: contratacao.id })
      cache.set(chave, resp && !resp.erro ? resp.sequencial : null)
    }
    const sequencial = cache.get(chave)
    resultado.push(sequencial != null ? { ...interacao, contratacao: { ...contratacao, sequencial } } : interacao)
  }
  return resultado
}

// Aditivos, itens e solicitações de fornecimento são sub-recursos
// (contratacoes/{id}/aditivos, contratacoes/{id}/itens,
// contratacoes/{id}/solicitacoesfornecimento/...) — não vêm na busca inicial.
// Busca só quando o usuário efetivamente age sobre UM contrato (enviar/gerar
// PDF), evitando N+1 requisições pra cada candidato da lista. Itens de cada
// aditivo (se existirem) vêm aninhados dentro do próprio aditivo.
// O veículo de cada publicação do contrato (campo cuja chave contém
// "veiculo", ex.: `veiculoPublicacao`) vem só com o id; o cadastro completo,
// com o nome, está em `veiculospublicacao` do Compras (pedido do usuário,
// 2026-10-19, ver buscarVeiculosPublicacao no service-worker.js). O valor pode
// ser o objeto ({ id, … }), só o id, ou uma lista deles. Best-effort: sem
// sessão do Compras, ou se a busca falhar, o campo fica como veio (JSON cru).
async function enriquecerVeiculosPublicacao(publicacoes) {
  const temVeiculo = (registro) => Object.keys(registro || {}).some((chave) => /veiculo/i.test(chave))
  if (!publicacoes.some(temVeiculo)) return publicacoes

  const resp = await chrome.runtime.sendMessage({ type: 'buscar-veiculos-publicacao' })
  if (!resp || resp.erro) return publicacoes
  const veiculoPorId = new Map((resp.veiculos || []).map((v) => [String(v.id), v]))

  const resolver = (valor) => {
    if (Array.isArray(valor)) return valor.map(resolver)
    const completo = veiculoPorId.get(idDoValor(valor))
    if (!completo) return valor
    return valor && typeof valor === 'object' ? { ...valor, ...completo } : completo
  }
  return publicacoes.map((registro) => {
    const enriquecido = { ...registro }
    for (const chave of Object.keys(registro || {})) {
      if (/veiculo/i.test(chave)) enriquecido[chave] = resolver(registro[chave])
    }
    return enriquecido
  })
}

// Itens da solicitação de fornecimento em ordem crescente do número do item
// (pedido do usuário, 2026-10-19). Mesmas chaves candidatas da coluna "Nº do
// item" (CAMPOS_ITEM em campos-relatorio.js). Item sem número vai pro fim,
// mantendo a ordem em que a API devolveu.
function ordenarItensPorNumero(itens) {
  const numeroDoItem = (raw) => {
    const valor = raw && ['numero', 'numeroItem', 'item', 'ordem'].map((chave) => raw[chave]).find((v) => v != null)
    const n = Number(valor)
    return valor != null && valor !== '' && Number.isFinite(n) ? n : Infinity
  }
  return itens
    .map((raw, indiceOriginal) => ({ raw, indiceOriginal, chave: numeroDoItem(raw) }))
    .sort((a, b) => (a.chave === b.chave ? a.indiceOriginal - b.indiceOriginal : a.chave - b.chave))
    .map((x) => x.raw)
}

// A listagem de alterações contratuais traz cada registro embrulhado
// (`{ tipoAlteracao, tipo, operacao, valor, aditivo | apostilamento }`). Aqui
// o registro é desembrulhado: o objeto interno (que é o que o relatório
// mostra) ganha `valor`/`operacao` do invólucro quando não os tem — o
// apostilamento só traz o valor no invólucro (ex.: reajuste de R$ 9.424,80).
function semAcento(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
}

// `tipoAlteracao` normalizado (sem acento, maiúsculo): ADITIVO, APOSTILAMENTO
// ou RESCISAO. A rescisão contratual é uma alteração como as outras (pedido do
// usuário, 2026-10-27) — o valor exato que o Betha devolve pra ela não foi
// confirmado ao vivo, por isso a comparação é por "RESCIS".
function tipoDaAlteracao(alteracao) {
  return semAcento(alteracao && alteracao.tipoAlteracao).toUpperCase()
}

function achatarAlteracao(alteracao) {
  const chaveInterna = Object.keys(alteracao).find(
    (chave) => semAcento(chave).toLowerCase() === tipoDaAlteracao(alteracao).toLowerCase(),
  )
  const interno = chaveInterna && alteracao[chaveInterna]
  const base = interno && typeof interno === 'object' ? interno : alteracao
  const resumo = {}
  if (alteracao.operacao) resumo.operacao = alteracao.operacao
  if (alteracao.valor != null && base.valorAditivo == null) resumo.valor = alteracao.valor
  // Anexos podem vir no invólucro em vez de no objeto interno.
  if (base !== alteracao && !Array.isArray(base.arquivos) && Array.isArray(alteracao.arquivos)) {
    resumo.arquivos = alteracao.arquivos
  }
  return { ...base, ...resumo }
}

// Separa a listagem de alterações em apostilamentos, rescisões e em aditivos
// que a listagem `aditivos` não trouxe (as duas fontes se complementam:
// nenhuma alteração contratual pode ficar de fora do relatório).
function separarAlteracoes(alteracoes, aditivosConhecidos) {
  const idsConhecidos = new Set(aditivosConhecidos.map((a) => String(a && a.id)))
  const apostilamentos = []
  const rescisoes = []
  const aditivosExtras = []
  for (const alteracao of alteracoes) {
    if (!alteracao || typeof alteracao !== 'object') continue
    const tipo = tipoDaAlteracao(alteracao)
    if (tipo === 'APOSTILAMENTO') apostilamentos.push(achatarAlteracao(alteracao))
    else if (tipo.startsWith('RESCIS')) rescisoes.push(achatarAlteracao(alteracao))
    else if (tipo === 'ADITIVO') {
      const aditivo = achatarAlteracao(alteracao)
      if (!idsConhecidos.has(String(aditivo.id ?? alteracao.idAlteracao))) aditivosExtras.push(aditivo)
    }
  }
  return { apostilamentos, rescisoes, aditivosExtras }
}

// O campo `aditivo` da solicitação de fornecimento vem só com `{ arquivos: [],
// id }` (pedido do usuário, 2026-10-23) — os dados do aditivo (sequencial,
// tipo, valor…) estão na listagem de alterações do contrato
// (contratacoes/{id}/alteracoes, `idAlteracao` = id do aditivo). Resolve pelo
// id usando os aditivos que já temos (listagem de aditivos + alterações; as
// alterações, formato confirmado ao vivo, têm prioridade). Best-effort: id que
// não aparece em nenhuma das duas fica como veio.
function enriquecerAditivosSolicitacoes(solicitacoes, aditivosDaListagem, alteracoes) {
  const porId = new Map()
  for (const aditivo of aditivosDaListagem) {
    if (aditivo && aditivo.id != null) porId.set(String(aditivo.id), aditivo)
  }
  for (const alteracao of alteracoes) {
    if (!alteracao || String(alteracao.tipoAlteracao || '').toUpperCase() !== 'ADITIVO') continue
    const aditivo = achatarAlteracao(alteracao)
    const id = aditivo.id ?? alteracao.idAlteracao
    if (id != null) porId.set(String(id), aditivo)
  }

  return solicitacoes.map((sf) => {
    const valor = sf && sf.aditivo
    const completo = porId.get(idDoValor(valor))
    if (!completo) return sf
    return { ...sf, aditivo: typeof valor === 'object' ? { ...valor, ...completo } : completo }
  })
}

async function comDetalhes(contrato) {
  if (contrato.id == null) return contrato

  const [
    respAditivos,
    respAlteracoes,
    respItens,
    respSf,
    respAnexosTextos,
    respAnexosPublicacao,
    respPublicacoes,
    respResponsaveis,
    respInteracoes,
  ] =
    await Promise.all([
      chrome.runtime.sendMessage({ type: 'buscar-aditivos', id: contrato.id }),
      chrome.runtime.sendMessage({ type: 'buscar-alteracoes', id: contrato.id }),
      chrome.runtime.sendMessage({ type: 'buscar-itens', id: contrato.id }),
      chrome.runtime.sendMessage({ type: 'buscar-solicitacoes-fornecimento', id: contrato.id }),
      chrome.runtime.sendMessage({ type: 'buscar-anexos-textos', id: contrato.id }),
      chrome.runtime.sendMessage({ type: 'buscar-anexos-publicacao', id: contrato.id }),
      chrome.runtime.sendMessage({ type: 'buscar-publicacoes', id: contrato.id }),
      chrome.runtime.sendMessage({ type: 'buscar-responsaveis', id: contrato.id }),
      chrome.runtime.sendMessage({ type: 'buscar-interacoes-contabilidade', id: contrato.id }),
    ])
  if (respAditivos && respAditivos.erro) throw new Error(respAditivos.erro)
  if (respItens && respItens.erro) throw new Error(respItens.erro)
  if (respSf && respSf.erro) throw new Error(respSf.erro)
  // Publicação é best-effort (caminho não confirmado ao vivo, ver
  // service-worker.js) — um erro aqui não pode travar o resto do relatório,
  // só faltam os anexos e os registros de publicação.
  if (respAnexosTextos && respAnexosTextos.erro) throw new Error(respAnexosTextos.erro)
  if (respResponsaveis && respResponsaveis.erro) throw new Error(respResponsaveis.erro)
  if (respInteracoes && respInteracoes.erro) throw new Error(respInteracoes.erro)

  // Alterações contratuais (endpoint confirmado, ver service-worker.js): um
  // erro na busca não trava o relatório, só ficam sem apostilamentos/aditivos
  // extras.
  const alteracoes = (respAlteracoes && !respAlteracoes.erro && respAlteracoes.alteracoes) || []
  const aditivosDaListagem = respAditivos.aditivos || []
  const separadas = separarAlteracoes(alteracoes, aditivosDaListagem)
  const apostilamentos = await enriquecerDescricoesCadastros(separadas.apostilamentos)
  const rescisoes = await enriquecerDescricoesCadastros(separadas.rescisoes)

  const aditivos = await enriquecerDescricoesCadastros([...aditivosDaListagem, ...separadas.aditivosExtras])
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

  // Recebimentos de cada solicitação de fornecimento — sub-recurso próprio
  // (contratacoes/{id}/solicitacoesfornecimento/{sfId}/recebimentos), não vem
  // junto da listagem de solicitações. Itens de cada recebimento (o que
  // efetivamente foi recebido do catálogo) são outro sub-recurso à parte,
  // buscado por cima de cada recebimento. Endpoints confirmados (ver
  // service-worker.js): erro em qualquer um interrompe o relatório, mesmo
  // critério das solicitações de fornecimento em si.
  const solicitacoes = enriquecerAditivosSolicitacoes(
    await enriquecerResponsaveis(await enriquecerDescricoesCadastros(respSf.solicitacoes || [])),
    aditivosDaListagem,
    alteracoes,
  )
  const solicitacoesComRecebimentos = await Promise.all(
    solicitacoes.map(async (sf) => {
      if (sf.id == null) return { ...sf, recebimentos: [] }

      // Itens da solicitação — usa os que já vierem na listagem; senão busca o
      // sub-recurso (caminho não confirmado ao vivo, ver service-worker.js).
      // Best-effort: erro aqui vira "sem itens vinculados", não trava o
      // relatório — mesmo critério dos itens de aditivo.
      let itensSf = Array.isArray(sf.itens) && sf.itens.length ? sf.itens : null
      if (!itensSf) {
        const respItensSf = await chrome.runtime.sendMessage({
          type: 'buscar-itens-solicitacao',
          contratoId: contrato.id,
          solicitacaoId: sf.id,
        })
        itensSf = (respItensSf && !respItensSf.erro && respItensSf.itens) || []
      }

      const resp = await chrome.runtime.sendMessage({
        type: 'buscar-recebimentos',
        contratoId: contrato.id,
        solicitacaoId: sf.id,
      })
      if (resp && resp.erro) throw new Error(resp.erro)
      const recebimentos = (resp && resp.recebimentos) || []
      const recebimentosComItens = await Promise.all(
        recebimentos.map(async (recebimento) => {
          if (recebimento.id == null) return { ...recebimento, itens: [] }
          const respItens = await chrome.runtime.sendMessage({
            type: 'buscar-itens-recebimento',
            contratoId: contrato.id,
            solicitacaoId: sf.id,
            recebimentoId: recebimento.id,
          })
          if (respItens && respItens.erro) throw new Error(respItens.erro)
          return { ...recebimento, itens: (respItens && respItens.itens) || [] }
        }),
      )
      return { ...sf, itens: ordenarItensPorNumero(itensSf), recebimentos: recebimentosComItens }
    }),
  )

  return {
    ...contrato,
    itens: respItens.itens || [],
    aditivos: aditivosComItens,
    apostilamentos,
    rescisoes,
    solicitacoesFornecimento: solicitacoesComRecebimentos,
    anexosTextos: respAnexosTextos.anexos || [],
    // Registros da rotina "Textos" — documento "textos contrato X".
    // `contratacao` de cada texto também só traz o id interno — vira o
    // sequencial (ver enriquecerSequenciaisContratacao).
    textos: await enriquecerSequenciaisContratacao(respAnexosTextos.textos || [], contrato),
    anexosPublicacao: (respAnexosPublicacao && !respAnexosPublicacao.erro && respAnexosPublicacao.anexos) || [],
    publicacoes: await enriquecerVeiculosPublicacao((respPublicacoes && !respPublicacoes.erro && respPublicacoes.publicacoes) || []),
    responsaveis: respResponsaveis.responsaveis || [],
    interacoesContabilidade: await enriquecerSequenciaisContratacao(
      await enriquecerNumerosDespesa(respInteracoes.interacoes || []),
      contrato,
    ),
  }
}

async function enviar(contrato, botao) {
  mostrarMsg('Buscando aditivos, apostilamentos, itens, solicitações de fornecimento, recebimentos, interações contábeis e documentos…', 'info')
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
  mostrarMsg('Buscando aditivos, apostilamentos, itens, solicitações de fornecimento, recebimentos, interações contábeis e documentos…', 'info')
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

async function buscarContratos() {
  resultadoEl.innerHTML = ''
  const sequencial = document.getElementById('sequencial').value.trim()
  const numeroAno = document.getElementById('numero').value.trim()
  const [numero, ano] = numeroAno.split('/')

  const resp = await chrome.runtime.sendMessage({ type: 'buscar-contrato', sequencial, numero, ano })
  if (resp && resp.erro) {
    mostrarMsg(resp.erro, 'erro')
    return
  }
  renderCandidatos(resp.candidatos || [])
}

// ---------------------------------------------------------------------------
// Processo administrativo (Betha Compras Cloud) — ver service-worker.js
// (buscarProcessos). Campos confirmados no projeto irmão Delta Intelligence:
// numeroProcesso, tipoObjeto.tipoDescricao (modalidade), objeto, situacaoDesc.
// ---------------------------------------------------------------------------

// Contexto (entidade + exercício) da sessão do Compras no momento da busca —
// vai junto no envio: o ano do processo é o exercício, e o id do processo só
// é único dentro da entidade.
let contextoCompras = { entidade: '', exercicio: '' }

function renderProcessos(lista, aproximado) {
  resultadoProcessoEl.innerHTML = ''
  if (!lista.length) {
    resultadoProcessoEl.innerHTML = '<p class="vazio">Nenhum processo administrativo encontrado.</p>'
    return
  }
  // Opção só aparece depois da busca, com processo na tela pra ela valer.
  opcoesProcessoEl.hidden = false
  if (aproximado) {
    mostrarMsg('Nenhum processo com esse número exato — mostrando números parecidos.', 'info')
  }
  for (const p of lista) {
    const numero = p.numeroProcesso != null
      ? (contextoCompras.exercicio ? `${p.numeroProcesso}/${contextoCompras.exercicio}` : String(p.numeroProcesso))
      : `Id ${p.id}`
    const situacao = p.situacaoDesc || ''
    const modalidade = (p.tipoObjeto && (p.tipoObjeto.tipoDescricao || p.tipoObjeto.descricao)) || ''
    const objeto = p.objeto || ''

    const div = document.createElement('div')
    div.className = 'candidato'
    const titulo = document.createElement('div')
    titulo.className = 'titulo'
    titulo.innerHTML = '<span class="numero"></span>'
    titulo.querySelector('.numero').textContent = numero
    if (situacao) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = situacao
      titulo.appendChild(badge)
    }
    const subtitulo = document.createElement('div')
    subtitulo.className = 'subtitulo'
    subtitulo.textContent = [modalidade, objeto.slice(0, 120)].filter(Boolean).join(' · ') || 'Sem objeto informado'
    const acoes = document.createElement('div')
    acoes.className = 'acoes'

    const btnEnviar = document.createElement('button')
    btnEnviar.className = 'btn btn-secundario'
    btnEnviar.innerHTML = `${ICONE_ENVIAR}<span>Enviar</span>`
    btnEnviar.addEventListener('click', () => enviarProcesso(p, btnEnviar))
    acoes.appendChild(btnEnviar)

    const btnPdf = document.createElement('button')
    btnPdf.className = 'btn btn-secundario'
    btnPdf.innerHTML = `${ICONE_PDF}<span>Gerar PDF</span>`
    btnPdf.addEventListener('click', () => gerarPdfProcesso(p, btnPdf))
    acoes.appendChild(btnPdf)

    div.append(titulo, subtitulo, acoes)
    resultadoProcessoEl.appendChild(div)
  }
}

// Processo + todos os sub-recursos (itens, lotes, participantes, pareceres,
// histórico… e anexos) — buscado só quando o usuário age sobre UM processo
// (enviar / gerar PDF), mesmo critério de `comDetalhes` nos contratos.
async function carregarProcessoCompleto(processo) {
  mostrarMsg('Buscando itens, lotes, participantes, pareceres, histórico e demais dados do processo…', 'info')
  const detalhes = await chrome.runtime.sendMessage({
    type: 'buscar-detalhes-processo',
    id: processo.id,
    arquivos: processo.arquivos,
  })
  if (detalhes && detalhes.erro) throw new Error(detalhes.erro)
  return {
    avisos: detalhes.avisos || [],
    processoCompleto: {
      ...processo,
      exercicio: contextoCompras.exercicio,
      entidadeToken: contextoCompras.entidade,
      subrecursos: detalhes.subrecursos,
    },
  }
}

// Contratações geradas pelo processo (contratos, atas, compras diretas…), cada
// uma já com todos os detalhes (`comDetalhes`) — só busca se o usuário marcou
// o checkbox. O vínculo é o `processoAdministrativo` (número + exercício) da
// própria contratação; ver buscarContratacoesDoProcesso no service-worker.js.
// Devolve `{ contratacoes, avisos }`; `avisos` são problemas não fatais.
async function carregarContratacoesVinculadas(processo) {
  if (!incluirContratacoesEl.checked) return { contratacoes: [], avisos: [] }

  mostrarMsg('Buscando as contratações vinculadas ao processo…', 'info')
  const resp = await chrome.runtime.sendMessage({
    type: 'buscar-contratacoes-do-processo',
    numero: processo.numeroProcesso,
    ano: contextoCompras.exercicio,
  })
  if (resp && resp.erro) throw new Error(`Contratações vinculadas: ${resp.erro}`)

  const avisos = []
  const encontradas = resp.contratacoes || []
  if (!encontradas.length) {
    avisos.push('nenhuma contratação vinculada a este processo foi encontrada')
  } else if (resp.via === 'varredura' && resp.truncado) {
    avisos.push('a lista de contratações pode estar incompleta (limite de varredura atingido)')
  }

  const contratacoes = []
  for (const [i, contratacao] of encontradas.entries()) {
    mostrarMsg(`Buscando os dados da contratação ${i + 1} de ${encontradas.length}…`, 'info')
    contratacoes.push(await comDetalhes(contratacao))
  }
  return { contratacoes, avisos }
}

function rotuloContratacao(c) {
  return c.numeroTermo != null ? (c.ano ? `${c.numeroTermo}/${c.ano}` : String(c.numeroTermo)) : `Seq. ${c.sequencial}`
}

async function enviarProcesso(processo, botao) {
  botao.disabled = true
  try {
    const { processoCompleto, avisos } = await carregarProcessoCompleto(processo)
    const vinculadas = await carregarContratacoesVinculadas(processo)
    avisos.push(...vinculadas.avisos)

    mostrarMsg('Enviando…', 'info')
    const resp = await chrome.runtime.sendMessage({ type: 'enviar-processo-para-central', processo: processoCompleto })
    if (resp && resp.erro) {
      mostrarMsg(resp.erro, 'erro')
      return
    }

    const falhas = []
    for (const contratacao of vinculadas.contratacoes) {
      const respContrato = await chrome.runtime.sendMessage({ type: 'enviar-para-central', contrato: contratacao })
      if (respContrato && respContrato.erro) falhas.push(`contratação ${rotuloContratacao(contratacao)}: ${respContrato.erro}`)
    }
    avisos.push(...falhas)

    const qtd = vinculadas.contratacoes.length - falhas.length
    const sufixo = qtd > 0 ? ` e ${qtd} contratação(ões) vinculada(s)` : ''
    if (avisos.length) {
      mostrarMsg(`Processo${sufixo} enviado(s), mas: ${avisos.join('; ')}.`, 'info')
    } else {
      mostrarMsg(`Processo${sufixo} enviado(s) com sucesso para a Central de Dados.`, 'ok')
    }
  } catch (e) {
    mostrarMsg(String((e && e.message) || e), 'erro')
  } finally {
    botao.disabled = false
  }
}

const CHAVE_RELATORIO_PROCESSO = 'centralDados.relatorioProcessoAtual'

// Abre a página de relatório (src/report/processo.html) numa aba nova — ela lê
// o processo salvo aqui, mostra a prévia e gera os PDFs + zip com os anexos,
// igual ao "Gerar PDF" dos contratos. Com o checkbox marcado, o mesmo zip
// leva também as contratações vinculadas (pasta própria).
async function gerarPdfProcesso(processo, botao) {
  botao.disabled = true
  try {
    const { processoCompleto, avisos } = await carregarProcessoCompleto(processo)
    const vinculadas = await carregarContratacoesVinculadas(processo)
    avisos.push(...vinculadas.avisos)

    // As contratações vão junto do processo, numa aba só: a página monta um
    // único zip com a pasta do processo e a pasta "Contratações".
    await chrome.storage.local.set({
      [CHAVE_RELATORIO_PROCESSO]: { ...processoCompleto, contratacoesVinculadas: vinculadas.contratacoes },
    })
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/report/processo.html') })
    mostrarMsg(avisos.length ? `Relatório aberto, mas: ${avisos.join('; ')}.` : '', avisos.length ? 'info' : '')
  } catch (e) {
    mostrarMsg(String((e && e.message) || e), 'erro')
  } finally {
    botao.disabled = false
  }
}

async function buscarProcessos() {
  resultadoProcessoEl.innerHTML = ''
  const [numero, ano] = document.getElementById('processo').value.trim().split('/')

  const resp = await chrome.runtime.sendMessage({ type: 'buscar-processo', numero, ano })
  if (resp && resp.erro) {
    mostrarMsg(resp.erro, 'erro')
    return
  }
  contextoCompras = resp.contexto || contextoCompras
  renderProcessos(resp.candidatos || [], resp.aproximado)
}

// Botão único de busca: consulta o Betha Contratos (sequencial e/ou número do
// contrato) e o Compras Cloud (processo administrativo) conforme os campos
// preenchidos. Com tudo em branco, mantém o comportamento anterior (busca de
// contrato, que devolve o aviso de campos obrigatórios).
buscarBtn.addEventListener('click', async () => {
  mostrarMsg('', '')
  resultadoEl.innerHTML = ''
  resultadoProcessoEl.innerHTML = ''
  opcoesProcessoEl.hidden = true
  buscarBtn.disabled = true
  buscarIconeEl.innerHTML = ICONE_SPINNER
  buscarTextoEl.textContent = 'Buscando…'

  const temProcesso = Boolean(document.getElementById('processo').value.trim())
  const temContrato = Boolean(
    document.getElementById('sequencial').value.trim() || document.getElementById('numero').value.trim(),
  )

  try {
    // Em sequência (não em paralelo): ambas escrevem na mesma área de mensagem.
    if (temContrato || !temProcesso) await buscarContratos()
    if (temProcesso) await buscarProcessos()
  } finally {
    buscarIconeEl.innerHTML = ICONE_BUSCA
    buscarTextoEl.textContent = 'Buscar'
    buscarBtn.disabled = false
  }
})

atualizarStatus()
