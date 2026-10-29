// Campos do relatório de um processo administrativo do Betha Compras Cloud —
// equivalente de campos-relatorio.js (contratos) e usado pela página
// report/processo.html e por pdf-relatorio-processo.js. Mesmo conjunto
// principal do relatório em Excel gerado pela Central
// (backend/src/routes/processos.ts).
//
// O registro recebido é o que popup.js monta em `carregarProcessoCompleto`:
// o JSON cru de `processosadministrativo` + `exercicio` + `entidadeToken` +
// `subrecursos` ({ itens, lotes, participantes, … , anexos }). Nomes de campo
// do processo confirmados no projeto irmão Delta Intelligence
// (betha/selectors.md): numeroProcesso, dataProcesso, tipoObjeto.tipoDescricao,
// objeto, valorTotalItens, quantidadeItens, situacao/situacaoDesc. O catálogo
// dos sub-recursos NÃO foi mapeado, então as tabelas escolhem as colunas
// pelos dados que vierem (ver montarTabelaGenerica) e os documentos por
// sub-recurso mostram TODOS os campos.
import {
  MENSAGEM_SEM_TEXTOS,
  conteudoTexto,
  formatarChave,
  formatarData,
  formatarValor,
  indexarEntidades,
  tituloBlocoTexto,
  valorCampoDinamico,
} from './campos-relatorio.js'

// Valor exibido de um campo de processo/sub-recurso. Além do que
// `valorCampoDinamico` já simplifica (descricao/nome/pessoa.nome/datas…),
// objetos de unidade de medida do Betha vêm como `{ simbolo }` (ex.: "UN") e
// cairiam no JSON.stringify, assim como os objetos de valorObjetoProcesso.
// `p` é o processo dono do registro (pra resolver as referências a ele e as
// entidades só com id).
function valorProcesso(chave, valor, p) {
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    if (valor.simbolo != null) return String(valor.simbolo)
    const especifico = valorObjetoProcesso(chave, valor, p)
    if (especifico != null) return especifico
  }
  return valorCampoDinamico(chave, valor, contextoProcesso(p))
}

// Objetos do Compras que não têm descricao/nome e cairiam no JSON cru —
// formatos vistos nos relatórios gerados pelo usuário (processos 229/2026 e
// 623/2026, 2026-10-21). Devolve null quando o objeto não tem o dado
// esperado, pra seguir pro valorCampoDinamico (e o JSON cru, se nada servir).
function valorObjetoProcesso(chave, valor, p) {
  // `processoAdministrativo` (pareceres, textos, atos finais, histórico…) e
  // `processoAdm` (despesas): é o próprio processo, repetido com flags
  // internas — mostra o número dele.
  if (/^processoAdm/i.test(chave)) {
    if (p && valor.id != null && String(valor.id) === String(p.id)) return numeroProcesso(p)
    if (valor.numeroProcesso != null) return String(valor.numeroProcesso)
  }
  if (chave === 'parametroExercicio' && valor.exercicio != null) return String(valor.exercicio)
  // Cadastros de entrega/pagamento/execução: a tela mostra a descrição. O local
  // de entrega pode vir sem descrição (só endereço): cai no logradouro. Sem
  // nenhum texto (cadastro não resolvido) segue o JSON cru, pra análise manual.
  if (['formaPagamento', 'prazoEntrega', 'localEntrega', 'regimeExecucao'].includes(chave)) {
    const texto = valor.descricao || valor.nome || valor.logradouro
    if (texto) return String(texto)
  }
  // `contratacao` do processo: dados da licitação/contratação direta —
  // modalidade + número sequencial (ex.: "Concorrência eletrônica 4/2026").
  if (chave === 'contratacao' && valor.numeroSequencial != null) {
    const numero = valor.anoSequencial != null ? `${valor.numeroSequencial}/${valor.anoSequencial}` : String(valor.numeroSequencial)
    const modalidade = valor.modalidade && valor.modalidade.descricao
    return modalidade ? `${modalidade} ${numero}` : numero
  }
  // `atoFinalBO` do histórico: o ato final que gerou a mudança de status.
  if (/^atoFinal/i.test(chave) && (valor.tipoAtoDesc || valor.tipoAto)) return String(valor.tipoAtoDesc || valor.tipoAto)
  // `statusAnterior` do histórico: o registro de histórico anterior inteiro —
  // o status anterior é o status novo daquele registro.
  if (chave === 'statusAnterior' && (valor.statusNovoDesc || valor.statusNovo)) return String(valor.statusNovoDesc || valor.statusNovo)
  return null
}

// Índice de entidades do processo inteiro (campos + sub-recursos), calculado
// uma vez por processo.
const contextos = new WeakMap()

function contextoProcesso(p) {
  if (!p || typeof p !== 'object') return {}
  if (!contextos.has(p)) contextos.set(p, { entidades: indexarEntidades(p) })
  return contextos.get(p)
}

// Colunas que não entram na tabela de itens (pedido do usuário). Comparadas
// sem acento/caixa e sem separadores, então valem para `especificacao`,
// `Especificação` etc. `diferencaDespesa…` cobre o campo
// "Diferença Despesa Entidade Participante".
const COLUNAS_ITENS_EXCLUIDAS = ['especificacao', 'amostra', 'configuracao', 'criteriodesempate', 'diferencadespesa']

function normalizarChave(chave) {
  return String(chave)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
}

function chaveExcluida(chave, excluir) {
  const n = normalizarChave(chave)
  return excluir.some((prefixo) => n.startsWith(prefixo))
}

// Sub-recursos que viram TABELA dentro do PDF/relatório do próprio processo.
export const SUBRECURSOS_EM_TABELA = [
  { chave: 'itens', rotulo: 'Itens', excluir: COLUNAS_ITENS_EXCLUIDAS },
  { chave: 'lotes', rotulo: 'Lotes' },
  { chave: 'participantes', rotulo: 'Participantes' },
]

// Sub-recursos que viram um DOCUMENTO próprio (um PDF cada), com todos os
// campos de cada registro — mesmo princípio dos aditivos/solicitações do
// contrato. `singular` nomeia cada bloco dentro do documento. `textos` (rotina
// "Textos" do processo, pedido do usuário, 2026-10-21) sai sempre, mesmo sem
// registros (aí com o aviso `vazio`), e cada bloco leva o título do texto —
// mesmo documento "textos contrato X" das contratações.
export const SUBRECURSOS_EM_DOCUMENTO = [
  { chave: 'pareceres', rotulo: 'pareceres', singular: 'parecer' },
  { chave: 'sessoesjulgamento', rotulo: 'sessões de julgamento', singular: 'sessão de julgamento' },
  { chave: 'atosfinais', rotulo: 'atos finais', singular: 'ato final' },
  { chave: 'despesas', rotulo: 'despesas', singular: 'despesa' },
  { chave: 'historico', rotulo: 'histórico', singular: 'registro' },
  { chave: 'atas', rotulo: 'atas de registro de preços', singular: 'ata', ocultar: ['itensAta'] },
  { chave: 'textos', rotulo: 'textos', singular: 'texto', vazio: MENSAGEM_SEM_TEXTOS },
]

export function numeroProcesso(p) {
  if (p.numeroProcesso == null) return p.id != null ? `id ${p.id}` : ''
  return p.exercicio ? `${p.numeroProcesso}/${p.exercicio}` : String(p.numeroProcesso)
}

// Descrição do documento — "processo 45/2026", mesmo padrão de
// tituloContrato ("contrato 12/2026"). Título dentro do PDF e base do nome do
// arquivo.
export function tituloProcesso(p) {
  const numero = numeroProcesso(p)
  return numero ? `processo ${numero}` : 'processo'
}

export function subrecurso(p, chave) {
  const lista = p && p.subrecursos && p.subrecursos[chave]
  return Array.isArray(lista) ? lista : []
}

// Chaves já mostradas nos campos principais, ou internas da extensão — não se
// repetem na lista "demais campos".
const CHAVES_PRINCIPAIS = new Set([
  'id',
  'numeroProcesso',
  'situacao',
  'situacaoDesc',
  'tipoObjeto',
  'objeto',
  'dataProcesso',
  'valorTotalItens',
  'quantidadeItens',
  'arquivos',
  'exercicio',
  'entidadeToken',
  'subrecursos',
])

// Rótulos que a tela do Compras usa (formulário "Editando processo
// administrativo") para campos cujo nome na API é diferente.
const ROTULOS_PROCESSO = {
  formaPagamento: 'Condição de pagamento',
  prazoEntrega: 'Prazo de entrega',
  localEntrega: 'Local de entrega',
  regimeExecucao: 'Regime de execução',
  formaJulgamento: 'Forma de julgamento',
  orcamentoSigiloso: 'Orçamento sigiloso',
  previsaoSubcontratacao: 'Previsão de subcontratação',
  controleSaldo: 'Controlar saldo por',
  controleSaldoDesc: 'Controlar saldo por (descrição)',
}

// Tipo de objeto (tela: "Compras e Serviços"): objeto com descrição ou enum em
// texto (ex.: COMPRAS_SERVICOS), que vira palavras.
function descricaoTipoObjeto(tipoObjeto) {
  if (tipoObjeto == null || tipoObjeto === '') return ''
  if (typeof tipoObjeto === 'object') {
    return String(tipoObjeto.tipoDescricao || tipoObjeto.descricao || tipoObjeto.nome || tipoObjeto.tipo || '')
  }
  const texto = String(tipoObjeto).replace(/_/g, ' ').toLowerCase()
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export function montarCamposProcesso(p) {
  const contratacao = p.contratacao && typeof p.contratacao === 'object' ? p.contratacao : {}
  const principais = [
    { label: 'Número/Ano', valor: numeroProcesso(p) },
    { label: 'Situação', valor: p.situacaoDesc || p.situacao || '' },
    // Na tela o campo "Modalidade" vem da contratação; "Tipo de objeto" é outro.
    { label: 'Modalidade', valor: (contratacao.modalidade && contratacao.modalidade.descricao) || '' },
    { label: 'Tipo de objeto', valor: descricaoTipoObjeto(p.tipoObjeto) },
    { label: 'Objeto', valor: p.objeto || '' },
    { label: 'Data do processo', valor: formatarData(p.dataProcesso) },
    { label: 'Valor total dos itens (R$)', valor: formatarValor(p.valorTotalItens) },
    { label: 'Quantidade de itens', valor: p.quantidadeItens ?? subrecurso(p, 'itens').length },
  ]
  // Demais campos que a API devolveu (pedido do usuário no Contratos: "todas
  // as informações") — depois dos principais, na ordem em que vierem.
  const demais = Object.entries(p)
    .filter(([chave]) => !CHAVES_PRINCIPAIS.has(chave))
    .map(([chave, valor]) => ({ label: ROTULOS_PROCESSO[chave] || formatarChave(chave), valor: valorProcesso(chave, valor, p) }))
  return [...principais, ...demais]
}

// Colunas preferidas (nesta ordem) quando o sub-recurso as tiver — o catálogo
// real não foi mapeado, então é só uma heurística pra escolher o que mostrar
// na tabela do PDF; o Excel traz todas as colunas.
const COLUNAS_PREFERIDAS = [
  'numero',
  'numeroItem',
  'item',
  'ordem',
  'sequencia',
  'descricao',
  'material',
  'especificacao',
  'nome',
  'pessoa',
  'fornecedor',
  'unidade',
  'unidadeMedida',
  'quantidade',
  'qtdItem',
  'valorUnitario',
  'valorTotal',
  'valor',
  'situacao',
  'situacaoDesc',
]

const MAX_COLUNAS_TABELA = 8

function ehChaveInterna(chave) {
  return chave === 'id' || /Id$/.test(chave) || chave === 'arquivos'
}

function ehChaveMonetaria(chave) {
  return /^(valor|vl|preco)/i.test(chave)
}

// Tabela com até MAX_COLUNAS_TABELA colunas escolhidas pelos dados presentes
// (preferidas primeiro, depois as demais na ordem em que aparecem).
// `omitidas` diz quantas colunas ficaram de fora, pro PDF avisar que o Excel
// tem o resto. `p` é o processo dono dos registros (ver valorProcesso).
export function montarTabelaGenerica(registros, excluir = [], p = null) {
  if (!Array.isArray(registros) || !registros.length) return { colunas: [], linhas: [], omitidas: 0 }

  const presentes = []
  for (const raw of registros) {
    for (const chave of Object.keys(raw || {})) {
      if (!ehChaveInterna(chave) && !chaveExcluida(chave, excluir) && !presentes.includes(chave)) presentes.push(chave)
    }
  }

  const preferidas = COLUNAS_PREFERIDAS.filter((c) => presentes.includes(c))
  // Depois das preferidas, o que a tela de itens mostra (unidade, valores,
  // situação) vem antes dos campos técnicos, que no processo 246/2026 tomaram
  // as 8 colunas e deixaram valor unitário/total de fora.
  const daTela = presentes.filter((c) => !preferidas.includes(c) && /^(unidade|valor|vl|preco|total|situacao)/i.test(c))
  const restantes = presentes.filter((c) => !preferidas.includes(c) && !daTela.includes(c))
  const ordenadas = [...preferidas, ...daTela, ...restantes]
  const escolhidas = ordenadas.slice(0, MAX_COLUNAS_TABELA)

  return {
    colunas: escolhidas.map(formatarChave),
    linhas: registros.map((raw) =>
      escolhidas.map((chave) => {
        const valor = raw ? raw[chave] : undefined
        return ehChaveMonetaria(chave) && valor != null && !Number.isNaN(Number(valor)) ? formatarValor(valor) : valorProcesso(chave, valor, p)
      }),
    ),
    omitidas: ordenadas.length - escolhidas.length,
  }
}

function camposDe(raw, p, ocultar = []) {
  return Object.entries(raw || {})
    .filter(([chave]) => !ocultar.includes(chave))
    .map(([chave, valor]) => ({ label: formatarChave(chave), valor: valorProcesso(chave, valor, p) }))
}

function nomeParticipante(raw) {
  const r = raw || {}
  const pessoa = r.pessoa || r.fornecedor || {}
  return String(pessoa.nome || r.nome || r.razaoSocial || pessoa.razaoSocial || '')
}

// Documento só com os participantes do processo: um bloco por participante
// (todos os campos) seguido de um bloco por proposta dele — as propostas vêm
// de `subrecursos.propostas`, marcadas com `participanteId` pelo service worker
// (ver buscarPropostasParticipantes). Devolve null sem participantes.
export function montarDocumentoParticipantes(p) {
  const documentos = montarDocumentosParticipantesIndividuais(p)
  if (!documentos.length) return null
  return {
    chave: 'participantes',
    titulo: `participantes do ${tituloProcesso(p)}`,
    blocos: documentos.flatMap((documento) => documento.blocos),
  }
}

// Pasta própria no zip do processo (pedido do usuário, 2026-10-29): um PDF
// por participante, agrupados em "Participantes".
export const PASTA_PARTICIPANTES = 'Participantes'

// Um documento por participante: o bloco dele (todos os campos) seguido de um
// bloco por proposta dele. Vazio sem participantes.
export function montarDocumentosParticipantesIndividuais(p) {
  const participantes = subrecurso(p, 'participantes')
  const propostas = subrecurso(p, 'propostas')
  const base = tituloProcesso(p)

  return participantes.map((raw, index) => {
    const nome = nomeParticipante(raw)
    const rotulo = nome ? `participante ${index + 1} — ${nome}` : `participante ${index + 1}`
    const blocos = [{ titulo: rotulo, campos: camposDe(raw, p) }]

    const dele = propostas.filter((proposta) => raw && proposta.participanteId === raw.id)
    if (!dele.length) {
      blocos.push({ titulo: `proposta do participante ${index + 1}`, campos: [{ label: 'Proposta', valor: 'Nenhuma proposta encontrada' }] })
    }
    dele.forEach((proposta, i) => {
      const sufixo = dele.length > 1 ? ` (${i + 1}/${dele.length})` : ''
      blocos.push({
        titulo: `proposta do participante ${index + 1}${sufixo}`,
        campos: camposDe(proposta, p, ['participanteId', 'participanteNome']),
      })
    })

    return { chave: 'participante', titulo: `${rotulo} do ${base}`, blocos }
  })
}

// Um documento por sub-recurso em `SUBRECURSOS_EM_DOCUMENTO` que tenha
// registros: cada registro vira um bloco com TODOS os campos que a API
// devolveu. Devolve [{ titulo, blocos: [{ titulo, campos }] }]. O primeiro é o
// dos participantes (com as propostas), quando houver.
export function montarDocumentosSubrecursos(p) {
  const base = tituloProcesso(p)
  const participantes = montarDocumentoParticipantes(p)
  const demais = montarDocumentosDemais(p, base)
  return participantes ? [participantes, ...demais] : demais
}

function montarDocumentosDemais(p, base) {
  return SUBRECURSOS_EM_DOCUMENTO.map((definicao) => ({ ...definicao, registros: subrecurso(p, definicao.chave) }))
    .filter(({ registros, vazio }) => registros.length || vazio)
    .map(({ chave, registros, rotulo, singular, vazio, ocultar }) => ({
      chave,
      titulo: `${rotulo} do ${base}`,
      vazio,
      blocos: registros.map((raw, index) =>
        chave === 'textos'
          ? { titulo: tituloBlocoTexto(raw, index), campos: camposTextoProcesso(raw, p) }
          : { titulo: `${singular} ${index + 1}`, campos: camposDe(raw, p, ocultar) },
      ),
    }))
}

// Atas de registro de preço — pasta própria no zip do processo (pedido do
// usuário, 2026-10-22): "Atas de Registro de Preço", com uma subpasta por ata
// contendo o PDF dela e a pasta com os anexos dela.
export const PASTA_ATAS_REGISTRO_PRECO = 'Atas de Registro de Preço'

export const MENSAGEM_SEM_ATAS = 'Nenhuma ata de registro de preço cadastrada para este processo'

function valorAfirmativo(valor) {
  if (valor === true) return true
  if (valor && typeof valor === 'object') return valorAfirmativo(valor.valor ?? valor.descricao ?? valor.value)
  return typeof valor === 'string' && /^(s|sim|true)$/i.test(valor.trim())
}

// O processo foi habilitado como registro de preço? O nome do campo no Compras
// não foi mapeado, então vale qualquer campo do processo (ou da `contratacao`
// dele) cujo nome contenha "registro de preço" (`registroPreco`,
// `sistemaRegistroPreco`…) ou seja `srp`, com valor afirmativo. Ter atas no
// sub-recurso `atasregistropreco` também conta — só existe ata em processo de
// registro de preço.
export function ehRegistroPreco(p) {
  if (subrecurso(p, 'atas').length) return true
  return [p, p && p.contratacao].some(
    (obj) =>
      obj &&
      typeof obj === 'object' &&
      Object.entries(obj).some(([chave, valor]) => {
        const n = normalizarChave(chave)
        return (n.includes('registropreco') || n === 'srp') && valorAfirmativo(valor)
      }),
  )
}

// Número da ata pros nomes de pasta/arquivo — o catálogo das atas não foi
// mapeado, então tenta os nomes usuais do Betha; sem nenhum, a ordem dela.
export function numeroAta(raw, index) {
  const r = raw || {}
  const numero = r.numeroAta ?? r.numero ?? r.numeroTermo ?? r.sequencial
  if (numero == null || numero === '') return String(index + 1)
  const ano = r.anoAta ?? r.ano ?? r.exercicio
  return ano != null && ano !== '' && !String(numero).includes('/') ? `${numero}/${ano}` : String(numero)
}

// Uma entrada por ata: título do PDF, campos (todos os que a API devolveu),
// tabela dos itens da ata (`itensAta`, ver completarAtasProcesso no
// service-worker.js) e os anexos (`arquivos` inline ou do GET da ata).
export function montarAtasRegistroPreco(p) {
  return subrecurso(p, 'atas').map((raw, index) => {
    const numero = numeroAta(raw, index)
    const itens = Array.isArray(raw && raw.itensAta) ? raw.itensAta : []
    return {
      numero,
      titulo: `ata ${numero} do ${tituloProcesso(p)}`,
      campos: camposDe(raw, p, ['itensAta']),
      itens: montarTabelaGenerica(itens, COLUNAS_ITENS_EXCLUIDAS, p),
      anexos: (Array.isArray(raw && raw.arquivos) ? raw.arquivos : [])
        .map((a) => ({ ...a, origem: `Ata ${numero}` }))
        .filter((a) => a && a.id),
    }
  })
}

// Campos de um texto do processo: `conteudo` (HTML do editor) vira texto
// corrido, igual nos textos da contratação; o resto segue valorProcesso.
function camposTextoProcesso(raw, p) {
  return Object.entries(raw || {}).map(([chave, valor]) => ({
    label: formatarChave(chave),
    valor: chave === 'conteudo' ? conteudoTexto(valor) : valorProcesso(chave, valor, p),
  }))
}

