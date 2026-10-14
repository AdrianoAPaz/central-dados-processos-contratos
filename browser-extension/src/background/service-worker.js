import {
  BETHA_CONTRATOS,
  BETHA_COMPRAS,
  ENDPOINT_CONTRATACOES,
  ENDPOINT_PROCESSOS,
  SUBRECURSOS_PROCESSO,
  AMBIENTE_CONTRATACAO_TODAS,
  STORAGE_KEYS,
} from '../shared/constants.js'

let headersCapturados = null
// Sessão do Betha Compras Cloud: headers + origem/prefixo da API observados na
// própria página (ver page/interceptor.js). Guardada à parte da do Contratos.
let sessaoCompras = null

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'headers-capturados') {
    if (message.sistema === 'compras') {
      sessaoCompras = { headers: message.headers, apiOrigin: message.apiOrigin, apiBasePath: message.apiBasePath }
      chrome.storage.session.set({ [STORAGE_KEYS.HEADERS_COMPRAS]: sessaoCompras }).catch(() => {})
    } else {
      headersCapturados = message.headers
      chrome.storage.session.set({ [STORAGE_KEYS.HEADERS]: message.headers }).catch(() => {})
    }
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'status') {
    Promise.all([resolverHeaders(), resolverSessaoCompras()]).then(([h, compras]) =>
      sendResponse({ conectado: !!h, comprasConectado: !!compras }),
    )
    return true
  }

  // Processo administrativo do Betha Compras Cloud (ver buscarProcessos).
  if (message.type === 'buscar-processo') {
    buscarProcessos(message.numero, message.ano)
      .then((candidatos) => sendResponse({ candidatos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'buscar-detalhes-processo') {
    buscarDetalhesProcesso(message.id)
      .then(sendResponse)
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'enviar-processo-para-central') {
    postarNaCentral('/api/processos', message.processo)
      .then(sendResponse)
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'buscar-contrato') {
    buscarContrato(message.sequencial, message.numero, message.ano)
      .then(sendResponse)
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'enviar-para-central') {
    enviarParaCentral(message.contrato)
      .then(sendResponse)
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'buscar-aditivos') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.id)}/aditivos`)
      .then((aditivos) => sendResponse({ aditivos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'buscar-itens') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.id)}/itens`)
      .then((itens) => sendResponse({ itens }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Best-effort: caminho conjecturado (mesmo padrão dos demais sub-recursos
  // do Betha, `<endpoint>/<id>/<subrecurso>`), nunca confirmado ao vivo por
  // não haver sessão disponível pra testar. Se o caminho estiver errado, o
  // Betha deve responder 404 e isso vira simplesmente "sem itens
  // vinculados" no relatório — não trava nada. Se aparecer errado/vazio
  // onde deveria ter dados, é o primeiro lugar a corrigir.
  if (message.type === 'buscar-itens-aditivo') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.contratoId)}/aditivos/${limparId(message.aditivoId)}/itens`)
      .then((itens) => sendResponse({ itens }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Solicitações de fornecimento vinculadas ao contrato. Sub-recurso especial:
  // GET na coleção dá 405 no Betha — só é listável via este POST lookup (ver
  // buscarSolicitacoesFornecimento abaixo).
  if (message.type === 'buscar-solicitacoes-fornecimento') {
    buscarSolicitacoesFornecimento(message.id)
      .then((solicitacoes) => sendResponse({ solicitacoes }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Recebimentos de UMA solicitação de fornecimento específica. Endpoint
  // confirmado ao vivo pelo usuário (2026-09-17): GET simples (diferente do
  // lookup POST das solicitações), ver buscarRecebimentos abaixo.
  if (message.type === 'buscar-recebimentos') {
    buscarRecebimentos(message.contratoId, message.solicitacaoId)
      .then((recebimentos) => sendResponse({ recebimentos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Itens de UM recebimento específico. Endpoint confirmado ao vivo pelo
  // usuário (2026-09-17), ver buscarItensRecebimento abaixo.
  if (message.type === 'buscar-itens-recebimento') {
    buscarItensRecebimento(message.contratoId, message.solicitacaoId, message.recebimentoId)
      .then((itens) => sendResponse({ itens }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Interações contábeis (empenhar/liquidar/pagar) vinculadas ao contrato.
  // Endpoint confirmado ao vivo pelo usuário (2026-09-17):
  // contratacoes/{id}/interacaocontabil/integracao-filtros — mesmo padrão de
  // lookup POST das solicitações de fornecimento (ver
  // buscarSolicitacoesFornecimento). O corpo exato do POST (filtros/sort
  // aceitos por este endpoint específico) não foi confirmado, só o caminho;
  // usa o mesmo formato mínimo já validado pra solicitações. Se o corpo
  // estiver errado, é o primeiro lugar a corrigir.
  if (message.type === 'buscar-interacoes-contabilidade') {
    buscarInteracoesContabilidade(message.id)
      .then((interacoes) => sendResponse({ interacoes }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Número da despesa orçamentária (ex.: "291") a partir do id interno que
  // vem em `despesa.id` dentro de cada rateio (`desdobramento`) de uma
  // interação contábil — esse id NÃO é o número da despesa que aparece nas
  // telas do Betha. Endpoint e formato confirmados ao vivo pelo usuário
  // (2026-09-22): GET despesas/{id}/saldo-despesa-na-data?data=aaaa-mm-dd
  // devolve `despesa.numero` (ver buscarNumeroDespesa abaixo).
  if (message.type === 'buscar-numero-despesa') {
    buscarNumeroDespesa(message.despesaId, message.data)
      .then((numero) => sendResponse({ numero }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Sequencial da contratação (o mesmo `sequencial` do documento do contrato)
  // a partir do `contratacao.id` de uma interação contábil, que só traz o id
  // interno. Ver buscarSequencialContratacao abaixo.
  if (message.type === 'buscar-sequencial-contratacao') {
    buscarSequencialContratacao(message.contratacaoId)
      .then((sequencial) => sendResponse({ sequencial }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Locais de entrega cadastrados (id -> descrição, ex.: "Na instituição").
  // A solicitação de fornecimento só traz o objeto do local com `descricao`
  // nula; a descrição real só vem desta listagem. Endpoint confirmado ao vivo
  // pelo usuário (2026-10-14): GET locaisentrega?filter=&limit=100&offset=0.
  if (message.type === 'buscar-locais-entrega') {
    buscarSubrecurso('locaisentrega')
      .then((locais) => sendResponse({ locais }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Tipos de objeto cadastrados (id -> descrição, ex.: "Outros Serviços").
  // Endpoint confirmado ao vivo pelo usuário (2026-10-14): GET tiposobjeto.
  if (message.type === 'buscar-tipos-objeto') {
    buscarSubrecurso('tiposobjeto')
      .then((tipos) => sendResponse({ tipos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Responsáveis do contrato (fiscal, gestor etc., com período de vigência).
  // Endpoint confirmado ao vivo pelo usuário (2026-09-17): GET
  // contratacoes/{id}/responsaveiscontratacao — diferente do que constava no
  // projeto irmão Delta Intelligence, que testou só `responsaveis` (404).
  if (message.type === 'buscar-responsaveis') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.id)}/responsaveiscontratacao`)
      .then((responsaveis) => sendResponse({ responsaveis }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Documentos da janela "Textos" do contrato. Confirmado ao vivo no projeto
  // irmão Delta Intelligence (2026-07-07): os anexos do contrato ficam
  // dentro dos textos, não no campo inline `arquivos` do próprio contrato
  // (ver buscarAnexosDeTextos abaixo).
  if (message.type === 'buscar-anexos-textos') {
    buscarAnexosDeTextos(message.id)
      .then((anexos) => sendResponse({ anexos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Documentos da janela "Publicação" do contrato. Best-effort: caminho
  // conjecturado (mesmo padrão de `buscar-itens-aditivo` acima), nunca
  // confirmado ao vivo. Se o caminho estiver errado, o Betha responde 404 e
  // isso vira "sem documentos de publicação" no relatório — não trava nada.
  // Se aparecer sempre vazio onde deveria ter dados, é o primeiro lugar a
  // corrigir (capturar a requisição real via DevTools na janela Publicação).
  if (message.type === 'buscar-anexos-publicacao') {
    buscarAnexosDeSubrecurso(message.id, 'publicacoes')
      .then((anexos) => sendResponse({ anexos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Baixa um anexo do Betha com o header de sessão e devolve os bytes em
  // base64 — não usa `chrome.downloads` (exigiria permissão nova no manifest,
  // que derruba a extensão até reaprovação da Chrome Web Store). Quem chamou
  // (report.js, que roda numa página com DOM completo) monta o Blob e
  // dispara o download local a partir dos bytes já recebidos.
  if (message.type === 'baixar-anexo') {
    baixarAnexo(message.arquivoId)
      .then(sendResponse)
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }
})

function limparId(id) {
  return String(id || '').replace(/[^\w-]/g, '')
}

async function resolverHeaders() {
  if (headersCapturados) return headersCapturados
  const stored = await chrome.storage.session.get(STORAGE_KEYS.HEADERS)
  headersCapturados = stored[STORAGE_KEYS.HEADERS] || null
  return headersCapturados
}

function montarAuthorization(auth) {
  return /^bearer\s/i.test(auth || '') ? auth : `Bearer ${auth}`
}

async function chamarBetha(filter) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const params = new URLSearchParams({
    ambienteContratacao: AMBIENTE_CONTRATACAO_TODAS,
    contratosDeOutrasEntidades: 'false',
    filter,
    limit: '20',
    offset: '0',
    sort: '',
    total: 'false',
  })
  const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${ENDPOINT_CONTRATACOES}?${params}`

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: montarAuthorization(headers.authorization),
      'App-Context': headers.appContext,
      'User-Access': headers.userAccess,
    },
  })
  if (!resp.ok) throw new Error(`API do Betha respondeu ${resp.status}`)
  const dados = await resp.json()
  return dados.content || []
}

async function buscarContrato(sequencial, numero, ano) {
  const seqLimpo = String(sequencial || '').replace(/\D/g, '')
  if (seqLimpo) {
    return { candidatos: await chamarBetha(`(((sequencial = ${seqLimpo})))`) }
  }

  const numLimpo = String(numero || '').replace(/\D/g, '')
  if (!numLimpo) throw new Error('Informe o sequencial ou o número do contrato.')
  const anoLimpo = String(ano || '').replace(/\D/g, '')
  const filter = anoLimpo
    ? `(((numeroTermoNumerico = ${numLimpo} and ano = ${anoLimpo})))`
    : `(((numeroTermoNumerico = ${numLimpo})))`
  return { candidatos: await chamarBetha(filter) }
}

// Sub-recurso genérico `<caminho>` (ex.: `contratacoes/{id}/aditivos`,
// `contratacoes/{id}/itens`) — mesmo padrão paginado de qualquer endpoint do
// Betha. Somente leitura; devolve os itens crus (sem supor nomes de campo
// que não foram confirmados ao vivo). 404 vira lista vazia (sub-recurso sem
// registros cadastrados), não erro — é um estado normal, não uma falha.
async function buscarSubrecurso(caminho) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const PAGINA = 50
  const MAX = 500
  const todos = []
  let offset = 0
  let hasNext = true

  while (hasNext && offset < MAX) {
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGINA) })
    const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${caminho}?${params}`
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
      },
    })
    if (!resp.ok) {
      if (offset === 0 && (resp.status === 404 || resp.status === 400)) return []
      throw new Error(`API do Betha respondeu ${resp.status} ao buscar ${caminho}`)
    }
    const dados = await resp.json()
    const pagina = Array.isArray(dados) ? dados : (dados.content || [])
    todos.push(...pagina)
    if (Array.isArray(dados) || !pagina.length) break
    hasNext = !!dados.hasNext
    offset += PAGINA
  }

  return todos
}

// GET de um item específico dentro de um sub-recurso (ex.: um texto
// individual, contratacoes/{id}/textos/{textoId}) — usado quando a listagem
// não traz `arquivos` inline pra esse item.
async function buscarItemDeSubrecurso(caminho) {
  const headers = await resolverHeaders()
  if (!headers) return null
  const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${caminho}`
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: montarAuthorization(headers.authorization),
      'App-Context': headers.appContext,
      'User-Access': headers.userAccess,
    },
  })
  if (!resp.ok) return null
  return resp.json()
}

// Anexos de um contrato ficam, na prática, dentro de sub-recursos como
// "textos" (documentos) ou "publicacoes" — não no campo inline `arquivos`
// do próprio contrato/aditivo, que quase sempre vem vazio. Confirmado ao
// vivo pra `textos` no projeto irmão Delta Intelligence (2026-07-07): GET
// contratacoes/{id}/textos → 200; cada item às vezes já traz `arquivos`
// inline, senão só o GET do item individual traz. Sequencial (não
// Promise.all) pra não rajar a API com N GETs de uma vez — mesma cautela já
// aplicada ao download dos anexos em si (ver montarPacoteRelatorio).
async function buscarAnexosDeSubrecurso(contratoId, subrecurso) {
  const registros = await buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(contratoId)}/${subrecurso}`)
  const anexos = []
  for (const registro of registros) {
    let arquivosDoRegistro = Array.isArray(registro && registro.arquivos) ? registro.arquivos : null
    if (!arquivosDoRegistro && registro && registro.id != null) {
      const detalhe = await buscarItemDeSubrecurso(
        `${ENDPOINT_CONTRATACOES}/${limparId(contratoId)}/${subrecurso}/${limparId(registro.id)}`,
      )
      arquivosDoRegistro = Array.isArray(detalhe && detalhe.arquivos) ? detalhe.arquivos : []
    }
    if (arquivosDoRegistro && arquivosDoRegistro.length) anexos.push(...arquivosDoRegistro)
  }
  return anexos
}

function buscarAnexosDeTextos(contratoId) {
  return buscarAnexosDeSubrecurso(contratoId, 'textos')
}

// Lookup POST — único sub-recurso do Betha Contratos que exige POST pra
// listar (GET na coleção de solicitacoesfornecimento responde 405; confirmado
// no projeto irmão Delta Intelligence, 2026-07-03/2026-07-16). Uso
// estritamente somente-leitura: pesquisa/filtra, nunca grava nada — mesma
// exceção já autorizada e validada lá.
async function postLookupBetha(caminho, corpoBase) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const accept = 'application/json, application/vnd.betha.lookup.LISTA+json'
  const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${caminho}?Accept=${encodeURIComponent(accept)}`

  const PAGINA = 20
  const MAX = 200
  const todos = []
  let offset = 0
  let hasNext = true

  while (hasNext && offset < MAX) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
        'Content-Type': 'application/json',
        Accept: accept,
      },
      body: JSON.stringify({ ...corpoBase, limit: PAGINA, offset }),
    })
    if (!resp.ok) throw new Error(`API do Betha respondeu ${resp.status} ao buscar ${caminho}`)
    const dados = await resp.json()
    const pagina = Array.isArray(dados.content) ? dados.content : []
    todos.push(...pagina)
    if (!pagina.length || !dados.hasNext) break
    hasNext = !!dados.hasNext
    offset += PAGINA
  }

  return todos
}

// Solicitações de fornecimento vinculadas a um contrato. Endpoint e corpo
// confirmados ao vivo no projeto irmão Delta Intelligence (2026-07-16,
// contrato real 123/2026): passar o id REAL do contrato no path (em vez do
// "0" usado na busca global por número) já escopa a lista pra esse contrato,
// sem precisar filtrar depois — `filter: ''` e `gestaosolicitacoes: false`
// (diferente da busca global por número, que usa filtro de texto e `true`).
async function buscarSolicitacoesFornecimento(contratoId) {
  const caminho = `${ENDPOINT_CONTRATACOES}/${limparId(contratoId)}/solicitacoesfornecimento/solicitacao-fornecimento-filtros`
  return postLookupBetha(caminho, {
    filter: '',
    ambienteContratacao: AMBIENTE_CONTRATACAO_TODAS,
    total: false,
    sort: 'data desc, numeroSolicitacao desc',
    gestaosolicitacoes: false,
  })
}

// Interações contábeis (empenhar/liquidar/pagar) vinculadas a um contrato.
// Endpoint confirmado ao vivo pelo usuário (2026-09-17, contrato real
// 8807027): contratacoes/{id}/interacaocontabil/integracao-filtros — mesmo
// padrão de lookup POST das solicitações de fornecimento. Corpo espelha o de
// buscarSolicitacoesFornecimento (nunca confirmado pra este endpoint
// específico, mas é o mesmo formato mínimo que o Betha já aceitou pro
// lookup irmão); ordena pela mais recente primeiro, mesmo critério das
// solicitações.
async function buscarInteracoesContabilidade(contratoId) {
  const caminho = `${ENDPOINT_CONTRATACOES}/${limparId(contratoId)}/interacaocontabil/integracao-filtros`
  return postLookupBetha(caminho, {
    filter: '',
    ambienteContratacao: AMBIENTE_CONTRATACAO_TODAS,
    total: false,
    sort: 'dataReferencia desc, sequencial desc',
  })
}

// Sequencial da contratação a partir do id interno (`contratacao.id`) que vem
// dentro de cada interação contábil. Reaproveita a mesma listagem de
// contratações usada em buscarContrato (que devolve `id` e `sequencial` de
// cada contrato), filtrando por `id` em vez de `sequencial`. O filtro por id
// segue a mesma sintaxe já validada pro `sequencial`, mas não foi confirmado
// ao vivo — se vier vazio, é o primeiro lugar a corrigir.
async function buscarSequencialContratacao(contratacaoId) {
  const id = String(contratacaoId || '').replace(/\D/g, '')
  if (!id) return null
  const candidatos = await chamarBetha(`(((id = ${id})))`)
  const contrato = candidatos.find((c) => String(c && c.id) === id)
  return contrato && contrato.sequencial != null ? contrato.sequencial : null
}

// Número da despesa (`despesa.numero`, ex.: 291) a partir do id interno
// (`despesa.id`) usado dentro do `desdobramento` de uma interação contábil.
// A "data" é exigida pelo endpoint (ele responde saldo NA data), mas não
// muda o número da despesa em si — quem chama decide a data (data de
// referência da própria interação, quando disponível, senão hoje). Resposta
// confirmada ao vivo pelo usuário (2026-09-22, despesa real 2730965):
// { "despesa": { "id", "numero": 291, ... }, "saldo", "dataFiltro", ... }.
async function buscarNumeroDespesa(despesaId, data) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const params = new URLSearchParams({ data })
  const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/despesas/${limparId(despesaId)}/saldo-despesa-na-data?${params}`
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: montarAuthorization(headers.authorization),
      'App-Context': headers.appContext,
      'User-Access': headers.userAccess,
    },
  })
  if (!resp.ok) throw new Error(`API do Betha respondeu ${resp.status} ao buscar a despesa ${despesaId}`)
  const dados = await resp.json()
  return dados && dados.despesa && dados.despesa.numero != null ? dados.despesa.numero : null
}

// Recebimentos de UMA solicitação de fornecimento. Endpoint confirmado ao
// vivo pelo usuário (2026-09-17, contrato real 8807027, solicitação
// 18226527): GET contratacoes/{contratoId}/solicitacoesfornecimento/
// {solicitacaoId}/recebimentos?filter=&offset=0&sort= — GET simples
// (diferente do lookup POST das solicitações/interações), paginado por
// offset/hasNext no mesmo formato de buscarSubrecurso. `filter`/`sort`
// vazios são mantidos na query pra bater exatamente com a chamada
// confirmada, mesmo que o Betha provavelmente aceitasse sem eles.
async function buscarRecebimentos(contratoId, solicitacaoId) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const PAGINA = 25
  const MAX = 500
  const todos = []
  let offset = 0
  let hasNext = true

  while (hasNext && offset < MAX) {
    const params = new URLSearchParams({ filter: '', offset: String(offset), sort: '' })
    const caminho = `${ENDPOINT_CONTRATACOES}/${limparId(contratoId)}/solicitacoesfornecimento/${limparId(solicitacaoId)}/recebimentos`
    const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${caminho}?${params}`
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
      },
    })
    if (!resp.ok) {
      if (offset === 0 && (resp.status === 404 || resp.status === 400)) return []
      throw new Error(`API do Betha respondeu ${resp.status} ao buscar recebimentos`)
    }
    const dados = await resp.json()
    const pagina = Array.isArray(dados.content) ? dados.content : []
    todos.push(...pagina)
    if (!pagina.length || !dados.hasNext) break
    hasNext = !!dados.hasNext
    offset += PAGINA
  }

  return todos
}

// Itens de UM recebimento (o que efetivamente foi recebido, do catálogo da
// solicitação de fornecimento). Endpoint confirmado ao vivo pelo usuário
// (2026-09-17, contrato real 8807027, solicitação 18226527, recebimento
// 6933800): GET contratacoes/{contratoId}/solicitacoesfornecimento/
// {solicitacaoId}/recebimentos/{recebimentoId}/itens?filter=&limit=20&
// offset=0&sort=numeroordem+asc — mesmo formato de paginação de
// buscarRecebimentos, com `sort` fixo em `numeroordem asc` (mesma ordem que
// a tela usa) em vez de vazio.
async function buscarItensRecebimento(contratoId, solicitacaoId, recebimentoId) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const PAGINA = 20
  const MAX = 500
  const todos = []
  let offset = 0
  let hasNext = true

  while (hasNext && offset < MAX) {
    const params = new URLSearchParams({ filter: '', limit: String(PAGINA), offset: String(offset), sort: 'numeroordem asc' })
    const caminho = `${ENDPOINT_CONTRATACOES}/${limparId(contratoId)}/solicitacoesfornecimento/${limparId(solicitacaoId)}/recebimentos/${limparId(recebimentoId)}/itens`
    const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/${caminho}?${params}`
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
      },
    })
    if (!resp.ok) {
      if (offset === 0 && (resp.status === 404 || resp.status === 400)) return []
      throw new Error(`API do Betha respondeu ${resp.status} ao buscar itens do recebimento`)
    }
    const dados = await resp.json()
    const pagina = Array.isArray(dados.content) ? dados.content : []
    todos.push(...pagina)
    if (!pagina.length || !dados.hasNext) break
    hasNext = !!dados.hasNext
    offset += PAGINA
  }

  return todos
}

// ---------------------------------------------------------------------------
// Betha Compras Cloud — processos administrativos (somente leitura)
//
// NADA disto foi confirmado ao vivo (ver constants.js, BETHA_COMPRAS): o
// caminho da coleção, a sintaxe do `filter` e os nomes dos sub-recursos são
// palpites pelo padrão do Betha Contratos. Se uma busca falhar com 404/400,
// o primeiro lugar a corrigir são as constantes e o filtro abaixo, conferindo
// a requisição real na aba Rede (DevTools) de uma tela de processo
// administrativo em compras.betha.cloud.
// ---------------------------------------------------------------------------

async function resolverSessaoCompras() {
  if (sessaoCompras) return sessaoCompras
  const stored = await chrome.storage.session.get(STORAGE_KEYS.HEADERS_COMPRAS)
  sessaoCompras = stored[STORAGE_KEYS.HEADERS_COMPRAS] || null
  return sessaoCompras
}

// URL base da API do Compras: a origem/prefixo observados na página, com o
// palpite de constants.js só como fallback.
function baseApiCompras(sessao) {
  const origem = sessao.apiOrigin || `https://${BETHA_COMPRAS.apiHost}`
  const prefixo = sessao.apiOrigin ? sessao.apiBasePath || '' : BETHA_COMPRAS.basePath
  return `${origem}${prefixo}`
}

async function getCompras(caminho, params) {
  const sessao = await resolverSessaoCompras()
  if (!sessao) {
    throw new Error('Sessão do Betha Compras Cloud não capturada. Abra compras.betha.cloud, faça login, navegue por alguma tela e tente de novo.')
  }
  const query = params ? `?${new URLSearchParams(params)}` : ''
  const resp = await fetch(`${baseApiCompras(sessao)}/${caminho}${query}`, {
    method: 'GET',
    headers: {
      Authorization: montarAuthorization(sessao.headers.authorization),
      'App-Context': sessao.headers.appContext,
      'User-Access': sessao.headers.userAccess,
    },
  })
  return resp
}

// Processos administrativos por número/ano (ano opcional).
async function buscarProcessos(numero, ano) {
  const numLimpo = String(numero || '').replace(/\D/g, '')
  if (!numLimpo) throw new Error('Informe o número do processo administrativo (ex.: 45/2026).')
  const anoLimpo = String(ano || '').replace(/\D/g, '')
  const filter = anoLimpo ? `(((numero = ${numLimpo} and ano = ${anoLimpo})))` : `(((numero = ${numLimpo})))`

  const resp = await getCompras(ENDPOINT_PROCESSOS, { filter, limit: '20', offset: '0', sort: '', total: 'false' })
  if (!resp.ok) {
    throw new Error(
      `API do Betha Compras respondeu ${resp.status} ao buscar processos (${ENDPOINT_PROCESSOS}). ` +
        'O caminho/filtro ainda não foi confirmado ao vivo — confira a requisição real no DevTools.',
    )
  }
  const dados = await resp.json()
  return Array.isArray(dados) ? dados : dados.content || []
}

// Sub-recurso paginado de UM processo. Diferente de buscarSubrecurso (Betha
// Contratos), 404/400 NÃO vira lista vazia em silêncio: como o caminho não foi
// confirmado, devolve também um `aviso` pro popup mostrar. Páginas por
// offset/hasNext (mesmo formato dos demais endpoints do Betha).
async function buscarSubrecursoProcesso(processoId, subrecurso) {
  const PAGINA = 50
  const MAX = 500
  const registros = []
  let offset = 0
  let hasNext = true

  while (hasNext && offset < MAX) {
    const resp = await getCompras(`${ENDPOINT_PROCESSOS}/${limparId(processoId)}/${subrecurso}`, {
      offset: String(offset),
      limit: String(PAGINA),
    })
    if (!resp.ok) {
      const aviso = `${subrecurso}: a API respondeu ${resp.status} (sem registros ou caminho não confirmado)`
      if (offset === 0 && (resp.status === 404 || resp.status === 400)) return { registros: [], aviso }
      throw new Error(`API do Betha Compras respondeu ${resp.status} ao buscar ${subrecurso} do processo`)
    }
    const dados = await resp.json()
    const pagina = Array.isArray(dados) ? dados : dados.content || []
    registros.push(...pagina)
    if (Array.isArray(dados) || !pagina.length) break
    hasNext = !!dados.hasNext
    offset += PAGINA
  }
  return { registros, aviso: null }
}

// Lotes, itens, fornecedores/propostas e documentos de um processo — um
// sub-recurso por vez (mesma cautela contra rajada dos demais). Devolve
// `{ lotes, itens, fornecedores, documentos, avisos }`.
async function buscarDetalhesProcesso(processoId) {
  const resultado = { avisos: [] }
  for (const [chave, subrecurso] of Object.entries(SUBRECURSOS_PROCESSO)) {
    const { registros, aviso } = await buscarSubrecursoProcesso(processoId, subrecurso)
    resultado[chave] = registros
    if (aviso) resultado.avisos.push(aviso)
  }
  return resultado
}

function enviarParaCentral(contrato) {
  return postarNaCentral('/api/contratos', contrato)
}

async function postarNaCentral(caminho, corpo) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.BACKEND_URL)
  const backendUrl = stored[STORAGE_KEYS.BACKEND_URL]
  if (!backendUrl) throw new Error('Configure a URL da Central de Dados nas Opções da extensão.')

  const resp = await fetch(`${backendUrl.replace(/\/$/, '')}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  if (!resp.ok) {
    const texto = await resp.text().catch(() => '')
    throw new Error(`Central de Dados respondeu ${resp.status}: ${texto}`)
  }
  return resp.json()
}

// Teto de tamanho por download — acima disso o pico de memória (ArrayBuffer +
// string binária + base64, ~5-6x o tamanho do arquivo) e o limite prático de
// serialização de mensagens da extensão (~64MB) fariam o download falhar de
// um jeito confuso em vez de dar um aviso claro. Mesmo limite usado e testado
// no projeto irmão Delta Intelligence.
const TAMANHO_MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024 // 30MB
const TIMEOUT_DOWNLOAD_MS = 60000

// Codifica em base64 sem `Buffer` (indisponível no service worker), em blocos
// de 32KB pra não estourar a pilha em arquivos grandes.
function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// Download de um anexo do contrato. URL confirmada ao vivo no projeto irmão
// Delta Intelligence (2026-07-16, mesma API do Betha Contratos):
// `<basePath>/arquivos/{id}/conteudo`, GET com o mesmo header de sessão dos
// demais endpoints — o objeto do anexo em si nunca traz uma URL pronta (só
// id/nome/tipo/tamanho), por isso um `<a href>` direto sempre falharia sem
// esses headers de autenticação.
async function baixarAnexo(arquivoId) {
  if (!arquivoId) return { erro: 'Anexo sem id para download.' }
  // Ids reais são UUID (ex.: "42b0df52-..."); qualquer coisa fora desse
  // formato é rejeitada antes de entrar na URL — defesa em profundidade
  // contra manipulação do caminho de uma requisição autenticada.
  if (!/^[A-Za-z0-9-]+$/.test(String(arquivoId))) {
    return { erro: 'Id de anexo inválido.' }
  }

  const headers = await resolverHeaders()
  if (!headers) {
    return { erro: 'Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.' }
  }

  const url = `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/arquivos/${arquivoId}/conteudo`
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
      },
      signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS),
    })
  } catch (e) {
    const timeout = e && e.name === 'TimeoutError'
    return { erro: timeout ? 'Tempo esgotado ao baixar o anexo. Tente novamente.' : `Falha de rede ao baixar: ${String((e && e.message) || e)}` }
  }
  if (!response.ok) {
    return { erro: `Falha ao baixar (${response.status})` }
  }

  const tamanhoAnunciado = Number(response.headers.get('Content-Length'))
  if (tamanhoAnunciado > TAMANHO_MAX_DOWNLOAD_BYTES) {
    return { erro: `Anexo muito grande para baixar pela extensão (${(tamanhoAnunciado / 1024 / 1024).toFixed(1)}MB). Baixe direto pelo Betha.` }
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > TAMANHO_MAX_DOWNLOAD_BYTES) {
    return { erro: `Anexo muito grande para baixar pela extensão (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB). Baixe direto pelo Betha.` }
  }

  const mimeType = response.headers.get('Content-Type') || 'application/octet-stream'
  return { success: true, base64: arrayBufferToBase64(buffer), mimeType }
}
