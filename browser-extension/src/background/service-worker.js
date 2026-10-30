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
      sessaoCompras = {
        headers: message.headers,
        apiOrigin: message.apiOrigin,
        apiBasePath: message.apiBasePath,
        contexto: message.contexto || { entidade: '', exercicio: '' },
      }
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
      sendResponse({
        conectado: !!h,
        comprasConectado: !!compras,
        comprasExercicio: (compras && compras.contexto && compras.contexto.exercicio) || '',
      }),
    )
    return true
  }

  // Processo administrativo do Betha Compras Cloud (ver buscarProcessos).
  if (message.type === 'buscar-processo') {
    buscarProcessos(message.numero, message.ano)
      .then(sendResponse)
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  if (message.type === 'buscar-detalhes-processo') {
    buscarDetalhesProcesso(message.id, message.arquivos, message.processo)
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

  // Contratações geradas pelo processo (ver buscarContratacoesDoProcesso).
  if (message.type === 'buscar-contratacoes-do-processo') {
    buscarContratacoesDoProcesso(message.numero, message.ano)
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

  // Todas as alterações contratuais do contrato (aditivos E apostilamentos
  // numa listagem só, cada registro com `tipoAlteracao` ADITIVO/APOSTILAMENTO
  // e o objeto completo em `aditivo`/`apostilamento`) — formato confirmado
  // pelo JSON cru que o usuário colou (2026-10-21). Endpoint confirmado ao
  // vivo pelo usuário (2026-10-21): GET contratacoes/{id}/alteracoes?filter=
  // &limit=20&offset=0&sort= (contrato real 8807434).
  if (message.type === 'buscar-alteracoes') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.id)}/alteracoes`)
      .then((alteracoes) => sendResponse({ alteracoes }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // "Resumo dos valores do contrato" da tela: GET contratacoes/{id}/resumo
  // (objeto único, não paginado; confirmado ao vivo em 2026-10-29) — valor do
  // contrato, executado, reajustes, supressões, acréscimos, saldo e total.
  if (message.type === 'buscar-resumo-valores') {
    buscarItemDeSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.id)}/resumo`)
      .then((resumo) => sendResponse({ resumo }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Despesas vinculadas ao contrato (tela "Despesas"): GET
  // contratacoes/{id}/despesas, paginado (confirmado ao vivo, 2026-10-29, com
  // lista vazia — o formato dos registros ainda não foi visto).
  if (message.type === 'buscar-despesas') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.id)}/despesas`)
      .then((despesas) => sendResponse({ despesas }))
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

  // Itens de UMA solicitação de fornecimento. Best-effort: caminho
  // conjecturado no mesmo padrão dos recebimentos
  // (`.../solicitacoesfornecimento/{sfId}/itens`), nunca confirmado ao vivo.
  // 404/400 vira "sem itens vinculados" (ver buscarSubrecurso); se aparecer
  // vazio onde a tela do Betha mostra itens, é o primeiro lugar a corrigir.
  if (message.type === 'buscar-itens-solicitacao') {
    buscarSubrecurso(
      `${ENDPOINT_CONTRATACOES}/${limparId(message.contratoId)}/solicitacoesfornecimento/${limparId(message.solicitacaoId)}/itens`,
    )
      .then((itens) => sendResponse({ itens }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Histórico (auditoria: quem registrou cada mudança de situação e quando) de
  // UMA solicitação de fornecimento. Endpoint confirmado ao vivo na tela
  // "Histórico" do Betha (2026-10-29): GET contratacoes/{id}/
  // solicitacoesfornecimento/{sfId}/historico — cada registro traz `usuario`
  // ({id, nome}), `dataHoraCriacao`, `situacaoDesc` e `observacao`.
  // Best-effort: erro vira sem histórico, não trava o relatório.
  if (message.type === 'buscar-historico-solicitacao') {
    buscarSubrecurso(
      `${ENDPOINT_CONTRATACOES}/${limparId(message.contratoId)}/solicitacoesfornecimento/${limparId(message.solicitacaoId)}/historico`,
    )
      .then((historico) => sendResponse({ historico }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Histórico de UMA interação contábil (popover "Últimas alterações" do
  // Betha, confirmado ao vivo em 2026-10-29): GET contratacoes/{id}/
  // interacaocontabil/{interacaoId}/integracaocontabildados — cada registro
  // traz `usuario`, `dhHistorico`, `situacaoDesc` e `informacao`. Best-effort.
  if (message.type === 'buscar-historico-interacao') {
    buscarSubrecurso(
      `${ENDPOINT_CONTRATACOES}/${limparId(message.contratoId)}/interacaocontabil/${limparId(message.interacaoId)}/integracaocontabildados`,
    )
      .then((historico) => sendResponse({ historico }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Histórico de UM arquivo anexado a um texto da contratação (menu "⋮" do
  // anexo no Betha: quem anexou e quando). Caminho ainda NÃO confirmado ao
  // vivo — segue o padrão dos demais históricos (.../{id}/historico).
  // Best-effort: erro vira anexo sem histórico, não trava o relatório.
  if (message.type === 'buscar-historico-arquivo-texto') {
    buscarSubrecurso(
      `${ENDPOINT_CONTRATACOES}/${limparId(message.contratoId)}/textos/${limparId(message.textoId)}/arquivos/${limparId(message.arquivoId)}/historico`,
    )
      .then((historico) => sendResponse({ historico }))
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
      .then(({ numero, recurso }) => sendResponse({ numero, recurso }))
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

  // Formas de pagamento cadastradas (id -> descrição, ex.: "30 DIAS APÓS
  // ENTREGA"). A solicitação de fornecimento só traz o id; endpoint informado
  // pelo usuário (2026-10-23): GET formaspagamento?filter=&limit=20&offset=0&sort=.
  if (message.type === 'buscar-formas-pagamento') {
    buscarSubrecurso('formaspagamento')
      .then((formas) => sendResponse({ formas }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Prazos de entrega cadastrados (id -> descrição). A solicitação de
  // fornecimento só traz o id; endpoint informado pelo usuário (2026-10-23):
  // GET prazosentrega?filter=&limit=20&offset=0&sort=.
  if (message.type === 'buscar-prazos-entrega') {
    buscarSubrecurso('prazosentrega')
      .then((prazos) => sendResponse({ prazos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Veículos de publicação cadastrados (Diário Oficial, jornal…), pra
  // resolver o veículo das publicações do contrato, que vem só com o id.
  // Fica na API do Compras, não na do Contratos — endpoint informado pelo
  // usuário (2026-10-19): GET veiculospublicacao?filter=&limit=20&offset=0&sort=.
  if (message.type === 'buscar-veiculos-publicacao') {
    buscarVeiculosPublicacao()
      .then((veiculos) => sendResponse({ veiculos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Cadastro completo de UM responsável a partir do id (ver
  // buscarResponsavelContratos). Usado nos campos que vêm só com o id.
  if (message.type === 'buscar-responsavel') {
    buscarResponsavelContratos(message.id)
      .then((responsavel) => sendResponse({ responsavel }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Cadastro de fundamento legal (GET fundamentoslegais/{id}, confirmado ao
  // vivo): o contrato traz só o id; `descricao` é o texto da tela, ex.:
  // "Lei 14.133/2021, Art. 74, II".
  if (message.type === 'buscar-fundamento-legal') {
    buscarItemDeSubrecurso(`fundamentoslegais/${limparId(message.id)}`)
      .then((fundamento) => sendResponse({ fundamento }))
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
  // (ver buscarTextosContrato abaixo). Devolve também os próprios textos
  // (com `arquivos` completos) pro documento "textos contrato X".
  if (message.type === 'buscar-anexos-textos') {
    buscarTextosContrato(message.id)
      .then(({ textos, anexos }) => sendResponse({ textos, anexos }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

  // Documentos da janela "Publicação" do contrato. Best-effort: caminho
  // conjecturado (mesmo padrão de `buscar-itens-aditivo` acima), nunca
  // confirmado ao vivo. Se o caminho estiver errado, o Betha responde 404 e
  // isso vira "sem documentos de publicação" no relatório — não trava nada.
  // Se aparecer sempre vazio onde deveria ter dados, é o primeiro lugar a
  // corrigir (capturar a requisição real via DevTools na janela Publicação).
  // Registros da janela "Publicação" do contrato (pra o documento
  // "publicação contrato X") — mesmo caminho conjecturado de
  // `buscar-anexos-publicacao` abaixo, com as mesmas ressalvas.
  if (message.type === 'buscar-publicacoes') {
    buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(message.id)}/publicacoes`)
      .then((publicacoes) => sendResponse({ publicacoes }))
      .catch((e) => sendResponse({ erro: String((e && e.message) || e) }))
    return true
  }

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
    baixarAnexo(message.arquivoId, message.sistema)
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

// Uma página da listagem `contratacoes`. Devolve `{ registros, hasNext }`; em
// erro HTTP lança um Error com `status` (quem chama decide se tenta outro
// filtro, como em buscarContratacoesDoProcesso).
async function listarContratacoes(filter, offset = 0, limit = 20) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }

  const params = new URLSearchParams({
    ambienteContratacao: AMBIENTE_CONTRATACAO_TODAS,
    contratosDeOutrasEntidades: 'false',
    filter,
    limit: String(limit),
    offset: String(offset),
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
  if (!resp.ok) {
    const erro = new Error(`API do Betha respondeu ${resp.status}`)
    erro.status = resp.status
    throw erro
  }
  const dados = await resp.json()
  const registros = Array.isArray(dados) ? dados : dados.content || []
  return { registros, hasNext: !Array.isArray(dados) && !!dados.hasNext }
}

async function chamarBetha(filter) {
  return (await listarContratacoes(filter)).registros
}

// Todas as páginas de um filtro, até `maximo` registros (`truncado` avisa que
// havia mais). Uma página por vez, mesma cautela contra rajada dos demais.
async function listarTodasContratacoes(filter, maximo) {
  const PAGINA = 100
  const registros = []
  let offset = 0
  let hasNext = true
  while (hasNext && registros.length < maximo) {
    const pagina = await listarContratacoes(filter, offset, PAGINA)
    registros.push(...pagina.registros)
    hasNext = pagina.hasNext && pagina.registros.length > 0
    offset += PAGINA
  }
  return { registros, truncado: hasNext }
}

// A contratação aponta o processo de origem em `processoAdministrativo`
// (`numero` e `ano`). Conferido sempre no cliente, sejam quais forem os
// filtros usados na busca — é isto que garante que só volta o que é do processo.
function pertenceAoProcesso(contratacao, numero, ano) {
  const p = contratacao && contratacao.processoAdministrativo
  if (!p || Number(p.numero) !== numero) return false
  return !ano || Number(p.ano) === ano
}

// Contratações (contratos, atas, compras diretas…) geradas por um processo
// administrativo do Compras. Nem o filtro por `processoAdministrativo` na API
// do Contratos foi confirmado ao vivo (só `sequencial`, `numeroTermoNumerico` e
// `ano` foram), então a busca tenta, em ordem:
//   1. filtro no servidor pelos campos aninhados do processo — aceito se a API
//      não recusar e as linhas devolvidas realmente forem do processo;
//   2. varredura das contratações do ano do processo (e do seguinte, pois o
//      contrato pode ser assinado no ano depois), filtrando no cliente.
// Devolve `{ contratacoes, via, truncado }`; `via` diz qual caminho respondeu.
async function buscarContratacoesDoProcesso(numeroBruto, anoBruto) {
  const numero = Number(String(numeroBruto || '').replace(/\D/g, ''))
  const ano = Number(String(anoBruto || '').replace(/\D/g, '')) || null
  if (!numero) throw new Error('Número do processo administrativo inválido para buscar as contratações vinculadas.')

  const MAXIMO_FILTRADO = 200
  const MAXIMO_VARREDURA = 1500

  const filtrosServidor = [
    ano
      ? `(((processoAdministrativo.numero = ${numero} and processoAdministrativo.ano = ${ano})))`
      : `(((processoAdministrativo.numero = ${numero})))`,
  ]
  for (const filtro of filtrosServidor) {
    let resultado
    try {
      resultado = await listarTodasContratacoes(filtro, MAXIMO_FILTRADO)
    } catch (e) {
      if (e && (e.status === 400 || e.status === 422)) continue
      throw e
    }
    const vinculadas = resultado.registros.filter((c) => pertenceAoProcesso(c, numero, ano))
    // Filtro honrado = tudo o que voltou é do processo (ou nada voltou: processo
    // sem contratações). Qualquer linha de outro processo mostra que a API
    // ignorou o filtro — o resultado seria parcial, então cai na varredura.
    if (vinculadas.length === resultado.registros.length) {
      return { contratacoes: vinculadas, via: 'filtro', truncado: resultado.truncado }
    }
  }

  const anos = ano ? [ano, ano + 1] : ['']
  const encontradas = new Map()
  let truncado = false
  for (const a of anos) {
    const filtro = a === '' ? '' : `(((ano = ${a})))`
    const resultado = await listarTodasContratacoes(filtro, MAXIMO_VARREDURA)
    truncado = truncado || resultado.truncado
    for (const c of resultado.registros) {
      if (pertenceAoProcesso(c, numero, ano)) encontradas.set(c.sequencial ?? c.id, c)
    }
  }
  return { contratacoes: [...encontradas.values()], via: 'varredura', truncado }
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
// Devolve os registros já com `arquivos` (o detalhe individual, quando
// buscado, completa o registro da listagem) e os anexos de todos juntos.
async function buscarRegistrosComArquivos(contratoId, subrecurso) {
  const registros = await buscarSubrecurso(`${ENDPOINT_CONTRATACOES}/${limparId(contratoId)}/${subrecurso}`)
  const completos = []
  const anexos = []
  for (const registro of registros) {
    let completo = registro
    if (!Array.isArray(registro && registro.arquivos) && registro && registro.id != null) {
      const detalhe = await buscarItemDeSubrecurso(
        `${ENDPOINT_CONTRATACOES}/${limparId(contratoId)}/${subrecurso}/${limparId(registro.id)}`,
      )
      completo = { ...registro, ...(detalhe || {}) }
      if (!Array.isArray(completo.arquivos)) completo.arquivos = []
    }
    completos.push(completo)
    if (completo && Array.isArray(completo.arquivos)) anexos.push(...completo.arquivos)
  }
  return { registros: completos, anexos }
}

async function buscarAnexosDeSubrecurso(contratoId, subrecurso) {
  return (await buscarRegistrosComArquivos(contratoId, subrecurso)).anexos
}

async function buscarTextosContrato(contratoId) {
  const { registros, anexos } = await buscarRegistrosComArquivos(contratoId, 'textos')
  return { textos: registros, anexos }
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

// Cadastro completo de um responsável (com `pessoa.nome`) a partir do id. Campos
// como "Responsável autorização/rejeição" da solicitação de fornecimento vêm só
// com o id; o registro está em `responsaveis/paginacao` (a tela usa esse
// endpoint com `filter=(nome elike ...) or (cpf elike ...)`, pedido do usuário,
// 2026-10-19). Tenta o filtro por id no servidor e, se a API recusar ou
// ignorar, varre as páginas — sempre conferindo o id no cliente, porque o
// filtro por id não foi confirmado ao vivo. Devolve null se não achar.
async function buscarResponsavelContratos(responsavelId) {
  const headers = await resolverHeaders()
  if (!headers) {
    throw new Error('Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.')
  }
  const alvo = String(responsavelId || '').replace(/\D/g, '')
  if (!alvo) return null

  const listar = async (filter, limit, offset) => {
    const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset), sort: '' })
    const resp = await fetch(`https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/responsaveis/paginacao?${params}`, {
      method: 'GET',
      headers: {
        Authorization: montarAuthorization(headers.authorization),
        'App-Context': headers.appContext,
        'User-Access': headers.userAccess,
      },
    })
    if (!resp.ok) return null
    const dados = await resp.json()
    return Array.isArray(dados) ? { content: dados, hasNext: false } : dados
  }
  const achar = (pagina) => ((pagina && pagina.content) || []).find((r) => r && String(r.id) === alvo)

  const exato = achar(await listar(`id = ${alvo}`, 20, 0))
  if (exato) return exato

  const PAGINA = 100
  const MAX_VARREDURA = 1000
  for (let offset = 0; offset < MAX_VARREDURA; ) {
    const pagina = await listar('', PAGINA, offset)
    if (!pagina) return null
    const achado = achar(pagina)
    if (achado) return achado
    const recebidos = (pagina.content || []).length
    if (!pagina.hasNext || !recebidos) break
    offset += recebidos
  }
  return null
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
  const despesa = dados && dados.despesa
  return {
    numero: despesa && despesa.numero != null ? despesa.numero : null,
    recurso: recursoDespesa(dados),
  }
}

// Recurso da despesa (pedido do usuário, 2026-10-28), no mesmo retorno do
// saldo-despesa-na-data — fica na raiz, ao lado de `despesa`, e não dentro
// dela. Confirmado no retorno real: `recurso: { numero: "150010010500",
// numeroFormatado: "1.500.1001.0500", descricao: "MDE" }`. Usa o número
// formatado; sem ele, cai no número cru.
function recursoDespesa(dados) {
  const recurso = dados && dados.recurso
  if (!recurso || typeof recurso !== 'object') return null
  const valor = recurso.numeroFormatado != null ? recurso.numeroFormatado : recurso.numero
  return valor != null && typeof valor !== 'object' ? valor : null
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
// Recurso `processosadministrativo`, filtro e sub-recursos confirmados ao vivo
// no projeto irmão Delta Intelligence (ver constants.js, BETHA_COMPRAS;
// collector.js `consultarProcesso` e betha/selectors.md de lá). Só GET.
// ---------------------------------------------------------------------------

async function resolverSessaoCompras() {
  if (sessaoCompras) return sessaoCompras
  const stored = await chrome.storage.session.get(STORAGE_KEYS.HEADERS_COMPRAS)
  sessaoCompras = stored[STORAGE_KEYS.HEADERS_COMPRAS] || null
  return sessaoCompras
}

async function exigirSessaoCompras() {
  const sessao = await resolverSessaoCompras()
  if (!sessao) {
    throw new Error('Sessão do Betha Compras Cloud não capturada. Abra compras.betha.cloud, faça login, navegue por alguma tela e tente de novo.')
  }
  return sessao
}

// URL base da API do Compras: a origem/prefixo observados na página, com
// constants.js só como fallback.
function baseApiCompras(sessao) {
  const origem = sessao.apiOrigin || `https://${BETHA_COMPRAS.apiHost}`
  const prefixo = sessao.apiOrigin ? sessao.apiBasePath || '' : BETHA_COMPRAS.basePath
  return `${origem}${prefixo}`
}

// GET no Compras; devolve a Response crua (quem chama decide o que fazer com
// 404/400).
async function getCompras(sessao, caminho, params) {
  const query = params ? `?${new URLSearchParams(params)}` : ''
  return fetch(`${baseApiCompras(sessao)}/${caminho}${query}`, {
    method: 'GET',
    headers: {
      Authorization: montarAuthorization(sessao.headers.authorization),
      'App-Context': sessao.headers.appContext,
      'User-Access': sessao.headers.userAccess,
    },
  })
}

async function listarProcessos(sessao, filter) {
  const resp = await getCompras(sessao, ENDPOINT_PROCESSOS, { offset: '0', limit: '20', filter })
  if (!resp.ok) {
    throw new Error(
      `API do Betha Compras respondeu ${resp.status} ao buscar processos administrativos ` +
        `(${baseApiCompras(sessao)}/${ENDPOINT_PROCESSOS}). Recarregue a página do Compras e tente de novo.`,
    )
  }
  const dados = await resp.json()
  return Array.isArray(dados) ? dados : dados.content || []
}

// Processo administrativo pelo número. No Compras o processo é identificado
// só pelo número (confirmado ao vivo: `numeroprocesso = "185"`); o ano é o
// EXERCÍCIO do contexto da sessão, não um campo do registro. Por isso, se o
// usuário digitou um ano diferente do exercício em que a sessão está, avisa em
// vez de devolver o processo de outro exercício. Sem resultado exato, devolve
// os parecidos (`elike`), marcados como `aproximado`.
async function buscarProcessos(numero, ano) {
  const numLimpo = String(numero || '').replace(/\D/g, '')
  if (!numLimpo) throw new Error('Informe o número do processo administrativo (ex.: 45/2026).')

  const sessao = await exigirSessaoCompras()
  const exercicio = (sessao.contexto && sessao.contexto.exercicio) || ''
  const anoLimpo = String(ano || '').replace(/\D/g, '')
  if (anoLimpo && exercicio && anoLimpo !== exercicio) {
    throw new Error(
      `A sessão do Compras Cloud está no exercício ${exercicio}, mas você pediu ${anoLimpo}. ` +
        'No Compras o ano do processo é o exercício: troque o exercício em compras.betha.cloud e tente de novo.',
    )
  }

  const contexto = sessao.contexto || { entidade: '', exercicio: '' }
  const exatos = await listarProcessos(sessao, `numeroprocesso = "${numLimpo}"`)
  if (exatos.length) return { candidatos: exatos, aproximado: false, contexto }

  const parecidos = await listarProcessos(sessao, `numeroprocesso elike "%${numLimpo}%"`)
  return { candidatos: parecidos, aproximado: true, contexto }
}

// Sub-recurso paginado de UM processo. 404/400 = sem registros (muitos
// processos não têm todos os sub-recursos). Mesmo envelope paginado do
// Betha, throttle entre páginas como nos demais.
async function buscarSubrecursoProcesso(sessao, processoId, subrecurso) {
  const PAGINA = 100
  const MAX = 500
  const registros = []
  let offset = 0
  let hasNext = true

  while (hasNext && registros.length < MAX) {
    const resp = await getCompras(sessao, `${ENDPOINT_PROCESSOS}/${limparId(processoId)}/${subrecurso}`, {
      offset: String(offset),
      limit: String(PAGINA),
    })
    if (!resp.ok) {
      if (offset === 0 && (resp.status === 404 || resp.status === 400)) return []
      throw new Error(`a API respondeu ${resp.status}`)
    }
    const dados = await resp.json()
    const pagina = Array.isArray(dados) ? dados : dados.content || []
    registros.push(...pagina)
    if (Array.isArray(dados) || !pagina.length) break
    hasNext = !!dados.hasNext
    offset = (typeof dados.offset === 'number' ? dados.offset : offset) + pagina.length
  }
  return registros
}

// Anexos (metadados: nome/id/tipo/tamanho — o conteúdo não é baixado) ficam no
// campo inline `arquivos` do processo e dentro dos `textos` (cada texto traz
// `arquivos` inline ou só no GET do texto individual). Mesma regra do Delta
// Intelligence (`_coletarAnexosDeTextos`); sequencial pra não rajar a API.
// `textos` já vem completo por completarTextosProcesso.
function coletarAnexosProcesso(arquivosInline, textos) {
  const anexos = Array.isArray(arquivosInline) ? [...arquivosInline] : []
  for (const texto of textos) {
    if (texto && Array.isArray(texto.arquivos)) anexos.push(...texto.arquivos)
  }
  return anexos
}

// Textos do processo com `arquivos` sempre preenchido — quando a listagem não
// traz, o GET do texto individual completa o registro (pro documento "textos
// do processo X" listar os arquivos de cada texto). Sequencial pra não rajar
// a API; falha no detalhe deixa o texto como veio, com `arquivos` vazio.
async function completarTextosProcesso(sessao, processoId, textos) {
  const completos = []
  for (const texto of textos) {
    if (!texto || Array.isArray(texto.arquivos) || texto.id == null) {
      completos.push(texto)
      continue
    }
    const resp = await getCompras(sessao, `${ENDPOINT_PROCESSOS}/${limparId(processoId)}/textos/${limparId(texto.id)}`)
    const detalhe = resp.ok ? await resp.json().catch(() => null) : null
    const completo = { ...texto, ...(detalhe || {}) }
    if (!Array.isArray(completo.arquivos)) completo.arquivos = []
    completos.push(completo)
  }
  return completos
}

// Atas de registro de preço do processo com `arquivos` sempre preenchido e os
// itens de cada ata em `itensAta` — pra pasta "Atas de Registro de Preço" do
// zip (uma subpasta por ata, com o PDF dela e os anexos; pedido do usuário,
// 2026-10-22). Mesma regra dos textos: quando a listagem não traz `arquivos`,
// o GET da ata individual (`atasregistropreco/{id}`) completa o registro. Nem
// esse GET nem `atasregistropreco/{id}/itens` foram confirmados ao vivo:
// 404/400 ou falha deixam a ata como veio (sem anexos/itens). Sequencial pra
// não rajar a API.
async function completarAtasProcesso(sessao, processoId, atas) {
  const caminhoAtas = `${ENDPOINT_PROCESSOS}/${limparId(processoId)}/${SUBRECURSOS_PROCESSO.atas}`
  const completas = []
  for (const ata of atas) {
    if (!ata || ata.id == null) {
      completas.push(ata)
      continue
    }
    let completa = { ...ata }
    if (!Array.isArray(completa.arquivos)) {
      const resp = await getCompras(sessao, `${caminhoAtas}/${limparId(ata.id)}`).catch(() => null)
      const detalhe = resp && resp.ok ? await resp.json().catch(() => null) : null
      completa = { ...completa, ...(detalhe || {}) }
      if (!Array.isArray(completa.arquivos)) completa.arquivos = []
    }
    completa.itensAta = await buscarSubrecursoProcesso(
      sessao,
      processoId,
      `${SUBRECURSOS_PROCESSO.atas}/${limparId(ata.id)}/itens`,
    ).catch(() => [])
    completas.push(completa)
  }
  return completas
}

// Nome exibível de um participante (fornecedor) — o catálogo do sub-recurso
// não foi mapeado, então tenta os lugares usuais do Betha.
function nomeParticipante(participante) {
  const p = participante || {}
  const pessoa = p.pessoa || p.fornecedor || {}
  return String(pessoa.nome || p.nome || p.razaoSocial || pessoa.razaoSocial || '')
}

// Propostas de cada participante — `participantes/{id}/propostas`, um
// participante por vez (mesma cautela contra rajada). Cada proposta volta
// marcada com `participanteId`/`participanteNome` pra o relatório (e o Excel
// da Central) ligarem a proposta ao participante. Participante sem proposta
// (404/400) simplesmente não gera registro.
async function buscarPropostasParticipantes(sessao, processoId, participantes) {
  const propostas = []
  for (const participante of participantes) {
    if (!participante || participante.id == null) continue
    // A tela do processo lê `participantes/{id}/propostas/itens` (valor unitário
    // e total de cada item, confirmado no código da página em 2026-10-29); o
    // `propostas` puro não devolvia nada no processo 246/2026 (participante com
    // "Possui proposta" = true e relatório "Nenhuma proposta encontrada").
    const registros = []
    for (const sufixo of ['propostas/itens', 'propostas']) {
      const encontrados = await buscarSubrecursoProcesso(
        sessao,
        processoId,
        `participantes/${limparId(participante.id)}/${sufixo}`,
      )
      if (encontrados.length) {
        registros.push(...encontrados)
        break
      }
    }
    for (const proposta of registros) {
      propostas.push({ ...proposta, participanteId: participante.id, participanteNome: nomeParticipante(participante) })
    }
  }
  return propostas
}

// Todos os veículos de publicação do Compras (cadastro pequeno; paginado pelo
// envelope de sempre). O offset avança pela quantidade recebida, caso a API
// limite a página a menos do que foi pedido.
async function buscarVeiculosPublicacao() {
  const sessao = await exigirSessaoCompras()
  const PAGINA = 100
  const MAX = 1000
  const veiculos = []
  for (let offset = 0; offset < MAX; ) {
    const resp = await getCompras(sessao, 'veiculospublicacao', { filter: '', limit: String(PAGINA), offset: String(offset), sort: '' })
    if (!resp.ok) throw new Error(`API do Betha Compras respondeu ${resp.status} ao buscar veículos de publicação`)
    const dados = await resp.json()
    const pagina = Array.isArray(dados) ? dados : dados.content || []
    veiculos.push(...pagina)
    if (Array.isArray(dados) || !pagina.length || !dados.hasNext) break
    offset += pagina.length
  }
  return veiculos
}

// Os atos finais trazem o `responsavel` só como o cadastro cru, sem nome (só o
// `id` vem preenchido; `pessoa`, `cargo`, `funcao`… vêm nulos — pedido do
// usuário, 2026-10-19). O registro completo está em `responsaveis/paginacao`.
// Tenta o filtro por id no servidor e, se a API recusar ou ignorar, varre as
// páginas — sempre conferindo o id no cliente, porque o filtro não foi
// confirmado ao vivo. Devolve null se não achar (o relatório mantém o que veio).
async function buscarResponsavelCompras(sessao, id) {
  const PAGINA = 100
  const MAX_VARREDURA = 1000
  const alvo = String(id)

  const listar = async (params) => {
    const resp = await getCompras(sessao, 'responsaveis/paginacao', { sort: '', ...params })
    if (!resp.ok) return null
    const dados = await resp.json()
    return Array.isArray(dados) ? { content: dados, hasNext: false } : dados
  }

  const filtrado = await listar({ filter: `id = ${alvo}`, limit: '20', offset: '0' })
  const exato = ((filtrado && filtrado.content) || []).find((r) => r && String(r.id) === alvo)
  if (exato) return exato

  for (let offset = 0; offset < MAX_VARREDURA; ) {
    const pagina = await listar({ filter: '', limit: String(PAGINA), offset: String(offset) })
    if (!pagina) return null
    const achado = (pagina.content || []).find((r) => r && String(r.id) === alvo)
    if (achado) return achado
    const recebidos = (pagina.content || []).length
    if (!pagina.hasNext || !recebidos) break
    offset += recebidos
  }
  return null
}

// Substitui, em cada registro (atos finais, pareceres), o `responsavel`
// (objeto só com id) pelo cadastro completo. Um id por vez e com cache
// (compartilhado entre os sub-recursos) — vários registros costumam ter o
// mesmo responsável. Falha ao buscar um responsável não derruba nada: o
// registro fica como veio. Os pareceres vêm no mesmo formato só com id
// (confirmado no relatório do processo 623/2026, 2026-10-21).
async function enriquecerResponsaveis(sessao, registros, cache) {
  const resultado = []
  for (const registro of registros) {
    const atual = registro && registro.responsavel
    if (!atual || typeof atual !== 'object' || atual.id == null || atual.pessoa) {
      resultado.push(registro)
      continue
    }
    const chave = String(atual.id)
    if (!cache.has(chave)) {
      cache.set(chave, await buscarResponsavelCompras(sessao, atual.id).catch(() => null))
    }
    const completo = cache.get(chave)
    resultado.push(completo ? { ...registro, responsavel: { ...atual, ...completo } } : registro)
  }
  return resultado
}

// O tipo do parecer vem só com o id (`descricao: null`, formato confirmado pelo
// usuário em 2026-10-29) e cairia no JSON cru. Busca o cadastro
// (GET tipospareceres, tem poucas dezenas de registros) uma vez e completa cada
// parecer pelo id. Falha ao buscar deixa o registro como veio.
async function enriquecerTiposParecer(sessao, registros) {
  const resp = await getCompras(sessao, 'tipospareceres', { filter: '', limit: '100', offset: '0', sort: '' })
  if (!resp.ok) throw new Error(`API do Betha respondeu ${resp.status} ao buscar tipospareceres`)
  const dados = await resp.json()
  const tipos = new Map((Array.isArray(dados) ? dados : dados.content || []).map((t) => [String(t.id), t]))
  return registros.map((registro) => {
    const chave = Object.keys(registro || {}).find((k) => /^tipo.*parecer/i.test(k))
    const atual = chave && registro[chave]
    if (!atual || typeof atual !== 'object' || atual.id == null || atual.descricao != null) return registro
    const completo = tipos.get(String(atual.id))
    return completo ? { ...registro, [chave]: { ...atual, ...completo } } : registro
  })
}

// Campos do processo que a tela mostra pelo nome do cadastro mas a API devolve
// só como `{ id }` (ex.: Condição de pagamento = "30 DIAS" chega como
// `formaPagamento: { id: 17224 }`; confirmado no relatório do processo 246/2026,
// 2026-10-29). chave do campo -> recurso do cadastro (nomes vistos nas rotas do
// próprio Compras).
const CADASTROS_DO_PROCESSO = {
  formaPagamento: 'formaspagamento',
  prazoEntrega: 'prazosentrega',
  localEntrega: 'locaisentrega',
  regimeExecucao: 'regimesexecucao',
}

// Completa o processo com o que a tela dele mostra e a listagem não traz: os
// campos do GET de detalhe (`processosadministrativo/{id}`, ex.: observações,
// vigência, categoria, organogramas) e o cadastro de cada campo acima. Devolve
// só os campos novos/completados, pra quem chama mesclar por cima do processo;
// falha em uma consulta vira aviso e o campo fica como veio.
async function completarProcesso(sessao, processo, avisos) {
  const completado = {}
  try {
    const resp = await getCompras(sessao, `${ENDPOINT_PROCESSOS}/${limparId(processo.id)}`)
    if (resp.ok) {
      const detalhe = await resp.json()
      if (detalhe && typeof detalhe === 'object' && !Array.isArray(detalhe)) Object.assign(completado, detalhe)
    }
  } catch (e) {
    avisos.push(`detalhe do processo: ${String((e && e.message) || e)}`)
  }

  const cache = new Map()
  for (const [chave, recurso] of Object.entries(CADASTROS_DO_PROCESSO)) {
    const atual = completado[chave] !== undefined ? completado[chave] : processo[chave]
    if (!atual || typeof atual !== 'object' || Array.isArray(atual) || atual.id == null) continue
    const id = String(atual.id)
    const chaveCache = `${recurso}/${id}`
    try {
      if (!cache.has(chaveCache)) {
        const resp = await getCompras(sessao, `${recurso}/${limparId(id)}`)
        cache.set(chaveCache, resp.ok ? await resp.json() : null)
      }
      const cadastro = cache.get(chaveCache)
      if (cadastro && typeof cadastro === 'object') completado[chave] = { ...atual, ...cadastro }
    } catch (e) {
      avisos.push(`${chave}: ${String((e && e.message) || e)}`)
    }
  }
  return completado
}

// Todos os sub-recursos de um processo — um por vez (mesma cautela contra
// rajada dos demais). Falha em UM sub-recurso (ex.: 403/500) não derruba os
// outros: vira aviso. Devolve `{ subrecursos: { <tipo>: [...] }, avisos }`.
async function buscarDetalhesProcesso(processoId, arquivosInline, processo) {
  const sessao = await exigirSessaoCompras()
  const subrecursos = {}
  const avisos = []

  const processoCompletado = await completarProcesso(sessao, { ...(processo || {}), id: processoId }, avisos)

  for (const [tipo, caminho] of Object.entries(SUBRECURSOS_PROCESSO)) {
    try {
      subrecursos[tipo] = await buscarSubrecursoProcesso(sessao, processoId, caminho)
    } catch (e) {
      subrecursos[tipo] = []
      avisos.push(`${tipo}: ${String((e && e.message) || e)}`)
    }
  }

  const responsaveis = new Map()
  for (const [tipo, rotulo] of [
    ['atosfinais', 'atos finais'],
    ['pareceres', 'pareceres'],
  ]) {
    try {
      subrecursos[tipo] = await enriquecerResponsaveis(sessao, subrecursos[tipo] || [], responsaveis)
    } catch (e) {
      avisos.push(`responsáveis dos ${rotulo}: ${String((e && e.message) || e)}`)
    }
  }

  try {
    subrecursos.pareceres = await enriquecerTiposParecer(sessao, subrecursos.pareceres || [])
  } catch (e) {
    avisos.push(`tipos dos pareceres: ${String((e && e.message) || e)}`)
  }

  try {
    subrecursos.propostas = await buscarPropostasParticipantes(sessao, processoId, subrecursos.participantes || [])
  } catch (e) {
    subrecursos.propostas = []
    avisos.push(`propostas: ${String((e && e.message) || e)}`)
  }

  try {
    subrecursos.textos = await completarTextosProcesso(sessao, processoId, subrecursos.textos || [])
  } catch (e) {
    avisos.push(`arquivos dos textos: ${String((e && e.message) || e)}`)
  }

  try {
    subrecursos.atas = await completarAtasProcesso(sessao, processoId, subrecursos.atas || [])
  } catch (e) {
    avisos.push(`anexos das atas de registro de preço: ${String((e && e.message) || e)}`)
  }

  try {
    subrecursos.anexos = coletarAnexosProcesso(arquivosInline, subrecursos.textos || [])
  } catch (e) {
    subrecursos.anexos = []
    avisos.push(`anexos: ${String((e && e.message) || e)}`)
  }

  return { subrecursos, avisos, processo: processoCompletado }
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
async function baixarAnexo(arquivoId, sistema) {
  if (!arquivoId) return { erro: 'Anexo sem id para download.' }
  // Ids reais são UUID (ex.: "42b0df52-..."); qualquer coisa fora desse
  // formato é rejeitada antes de entrar na URL — defesa em profundidade
  // contra manipulação do caminho de uma requisição autenticada.
  if (!/^[A-Za-z0-9-]+$/.test(String(arquivoId))) {
    return { erro: 'Id de anexo inválido.' }
  }

  // Mesmo caminho `arquivos/{id}/conteudo` nos dois sistemas (confirmado ao
  // vivo no projeto irmão Delta Intelligence, 2026-07-16); muda só a base e a
  // sessão. `sistema: 'compras'` vem do relatório de processo administrativo.
  const doCompras = sistema === 'compras'
  const sessaoCompraDoAnexo = doCompras ? await resolverSessaoCompras() : null
  const headers = doCompras ? sessaoCompraDoAnexo && sessaoCompraDoAnexo.headers : await resolverHeaders()
  if (!headers) {
    return {
      erro: doCompras
        ? 'Sessão do Betha Compras Cloud não capturada. Abra compras.betha.cloud, faça login e tente de novo.'
        : 'Sessão do Betha Contratos não capturada. Abra contratos.betha.cloud, faça login e tente de novo.',
    }
  }

  const url = doCompras
    ? `${baseApiCompras(sessaoCompraDoAnexo)}/arquivos/${arquivoId}/conteudo`
    : `https://${BETHA_CONTRATOS.apiHost}${BETHA_CONTRATOS.basePath}/arquivos/${arquivoId}/conteudo`
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
