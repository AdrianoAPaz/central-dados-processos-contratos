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
  montarTabelaHistoricoAnexos,
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
  // A tela mostra data e hora dos registros (ex.: parecer "26/10/2026
  // 10:46:37"); o formato padrão do relatório cortaria a hora. Lê os números
  // da própria string, sem converter fuso. Meia-noite fica só com a data.
  const dataHora = typeof valor === 'string' && valor.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/)
  if (dataHora && !/^00:00(:00)?$/.test(dataHora[4]) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(valor)) return `${dataHora[3]}/${dataHora[2]}/${dataHora[1]} ${dataHora[4]}`
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    if (valor.simbolo != null) return String(valor.simbolo)
    const especifico = valorObjetoProcesso(chave, valor, p)
    if (especifico != null) return especifico
  }
  return valorCampoDinamico(chave, valor, contextoProcesso(p))
}

// Rótulo de um cadastro aninhado do Betha ({ descricao } ou texto direto).
function rotuloCadastro(v) {
  if (v == null || v === '') return ''
  return typeof v === 'object' ? String(v.descricao || v.nome || v.tipoDescricao || '') : String(v)
}

// Pessoa (autoridade, membro): "NOME (CPF)" ou "NOME (Papel)". Devolve ''
// sem nenhum texto — quem chama segue pro JSON cru, pra análise manual.
// Formato visto em /contratacao (2026-10-30): membro = { responsavel: { pessoa:
// { nome, cpfCnpj } }, atribuicaoDesc }; autoridade = { pessoa: { nome, cpfCnpj } }.
function descreverPessoa(o) {
  if (!o || typeof o !== 'object') return rotuloCadastro(o)
  const responsavel = o.responsavel && typeof o.responsavel === 'object' ? o.responsavel : o
  const pessoa = responsavel.pessoa && typeof responsavel.pessoa === 'object' ? responsavel.pessoa : responsavel
  const nome = pessoa.nome || o.nome || ''
  if (!nome) return ''
  // Membro mostra o papel (Pregoeiro, Membro/Equipe de apoio); a autoridade, o CPF.
  const complemento = o.atribuicaoDesc || rotuloCadastro(o.atribuicao) || formatarCpfCnpj(pessoa.cpfCnpj || pessoa.cpf)
  return complemento ? `${nome} (${complemento})` : String(nome)
}

function formatarCpfCnpj(valor) {
  const d = String(valor || '').replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return d
}

// Comissão julgadora como na tela: "53 - Permanente - FULANO (Pregoeiro),
// CICLANA (Membro/Equipe de apoio)". Sem membros, cai na pessoa/descrição.
function descreverPessoasOuComissao(valor) {
  if (Array.isArray(valor)) return valor.map(descreverPessoa).filter(Boolean).join(', ')
  if (!valor || typeof valor !== 'object') return ''
  // `membroComissao` = { comissaoLicitacao: { numero, tipoComissaoLicitacaoDesc, membros } }.
  const comissao = valor.comissaoLicitacao && typeof valor.comissaoLicitacao === 'object' ? valor.comissaoLicitacao : valor
  const membros = comissao.membros || comissao.integrantes || comissao.membrosComissao || comissao.pessoas
  if (Array.isArray(membros) && membros.length) {
    const cabecalho = [comissao.numero ?? comissao.codigo, comissao.tipoComissaoLicitacaoDesc || rotuloCadastro(comissao.tipo), comissao.descricao]
      .filter((v) => v != null && v !== '')
      .join(' - ')
    const lista = membros.map(descreverPessoa).filter(Boolean).join(', ')
    return cabecalho ? `${cabecalho} - ${lista}` : lista
  }
  return descreverPessoa(valor)
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
  // Comissão julgadora e autoridade competente (tela "Forma de contratação"):
  // nome/descrição e, na comissão, os membros com o papel de cada um.
  if (/comissao|autoridade/i.test(chave)) {
    const texto = descreverPessoasOuComissao(valor)
    if (texto) return texto
  }
  // Ata gerada a partir de uma ata cancelada: a tela mostra o número dela.
  if (/^ataCancelada/i.test(chave) && valor.numeroAta != null) {
    return valor.anoAta != null ? `${valor.numeroAta}/${valor.anoAta}` : String(valor.numeroAta)
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
  { chave: 'participantes', rotulo: 'Participantes', montar: montarTabelaParticipantes },
  { chave: 'entidadesparticipantes', rotulo: 'Entidades participantes' },
]

// Tabela de participantes com as colunas da tela "Participantes" (formato visto
// em 2026-10-30): a genérica cortava nas 8 primeiras chaves e deixava de fora o
// "Local/Regional" (`sedeMpeDesc`, só vem para quem declarou MPE).
function montarTabelaParticipantes(participantes, p) {
  if (!Array.isArray(participantes) || !participantes.length) return { colunas: [], linhas: [], omitidas: 0 }
  const texto = (v) => (v == null ? '' : String(v))
  const simNao = (v) => (v == null ? '' : v ? 'Sim' : 'Não')
  return {
    colunas: ['Participante', 'CPF/CNPJ', 'Tipo de participação', 'Declaração MPE', 'Local/Regional', 'Situação da documentação', 'Credenciamento', 'Renunciou recurso', 'Possui proposta'],
    linhas: participantes.map((r) => [
      texto(r.nome || (r.fornecedor && r.fornecedor.pessoa && r.fornecedor.pessoa.nome)),
      formatarCpfCnpj(r.cpfCnpj || (r.fornecedor && r.fornecedor.pessoa && r.fornecedor.pessoa.cpfCnpj)),
      texto(r.tipoParticipacaoDesc || r.tipoParticipacao),
      simNao(r.declaracaoMPE),
      texto(r.sedeMpeDesc),
      texto(r.situacaoDocumentacaoDesc || r.situacaoDocumentacao),
      texto(valorProcesso('dhCredenciamento', r.dhCredenciamento, p)),
      simNao(r.renunciouRecurso),
      simNao(r.possuiProposta),
    ]),
    omitidas: 0,
  }
}

// Sub-recursos que viram um DOCUMENTO próprio (um PDF cada), com todos os
// campos de cada registro — mesmo princípio dos aditivos/solicitações do
// contrato. `singular` nomeia cada bloco dentro do documento. `textos` (rotina
// "Textos" do processo, pedido do usuário, 2026-10-21) sai sempre, mesmo sem
// registros (aí com o aviso `vazio`), e cada bloco leva o título do texto —
// mesmo documento "textos contrato X" das contratações.
export const SUBRECURSOS_EM_DOCUMENTO = [
  { chave: 'pareceres', rotulo: 'pareceres', singular: 'parecer' },
  { chave: 'sessoesjulgamento', rotulo: 'sessões de julgamento', singular: 'sessão de julgamento' },
  { chave: 'atassessao', rotulo: 'atas das sessões de julgamento', singular: 'ata da sessão' },
  { chave: 'atosfinais', rotulo: 'atos finais', singular: 'ato final' },
  { chave: 'despesas', rotulo: 'despesas', singular: 'despesa' },
  { chave: 'historico', rotulo: 'histórico', singular: 'registro' },
  { chave: 'publicacoes', rotulo: 'publicações', singular: 'publicação' },
  { chave: 'impugnacoes', rotulo: 'impugnações', singular: 'impugnação' },
  { chave: 'documentosexigidos', rotulo: 'documentos exigidos', singular: 'documento exigido' },
  { chave: 'atas', rotulo: 'atas de registro de preços', singular: 'ata', ocultar: ['itensAta', 'ocorrencias'] },
  { chave: 'textos', rotulo: 'textos', singular: 'texto', vazio: MENSAGEM_SEM_TEXTOS },
]

// Histórico do processo (tela "Histórico" do Compras) — trilha de auditoria:
// cada mudança de situação com data/hora, quem registrou, situação anterior e
// nova, ato final e observação. Cronológico (mais antigo primeiro). É um
// RESUMO: o documento mantém, logo abaixo, o bloco com TODOS os campos de cada
// registro, então nada do que a API devolveu deixa de aparecer. Os nomes dos
// campos têm mais de uma variante (o catálogo não foi totalmente mapeado).
export function montarTabelaHistoricoProcesso(registros, p = null) {
  if (!Array.isArray(registros) || !registros.length) return { colunas: [], linhas: [] }
  const dataHoraDe = (h) => (h && (h.dataHoraCriacao || h.dhCriacao || h.dhHistorico || h.dataHora || h.data)) || ''
  const ordenados = [...registros].sort((a, b) => String(dataHoraDe(a)).localeCompare(String(dataHoraDe(b))))
  const texto = (chave, valor) => (valor == null || valor === '' ? '' : String(valorProcesso(chave, valor, p)))
  const quem = (h) => {
    const u = (h && (h.usuario || h.usuarioCriacao)) || ''
    return typeof u === 'object' ? String(u.nome || u.login || u.id || '') : String(u)
  }
  return {
    colunas: ['Data/hora', 'Registrado por', 'Situação anterior', 'Nova situação', 'Ato final', 'Observação'],
    linhas: ordenados.map((h) => [
      texto('dataHoraCriacao', dataHoraDe(h)),
      quem(h),
      texto('statusAnterior', h && h.statusAnterior),
      texto('statusNovo', h && (h.statusNovoDesc || h.statusNovo || h.situacaoDesc || h.situacao)),
      texto('atoFinalBO', h && (h.atoFinalBO || h.atoFinal)),
      texto('observacao', h && (h.observacao || h.motivo || h.justificativa || h.informacao)),
    ]),
  }
}

// "Anexados por" (arquivo, quem anexou e quando) dos anexos do processo — o
// `arquivos` do processo e o dos textos, já reunidos em `subrecursos.anexos`.
export function montarTabelaAnexadosProcesso(p) {
  return montarTabelaHistoricoAnexos(subrecurso(p, 'anexos'))
}

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

// Rótulos da tela "Forma de contratação" para campos do `contratacao` cujo
// nome na API é diferente.
const ROTULOS_CONTRATACAO = {
  dataInicioRecebimentoEnvelope: 'Recebimento dos envelopes — início',
  dataFinalRecebimentoEnvelope: 'Recebimento dos envelopes — fim',
  dataAberturaEnvelope: 'Abertura dos envelopes',
  dtFormaContratacao: 'Data da forma de contratação',
  percentCotaReservada: 'Percentual de cota reservada',
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
  // Tela "Forma de contratação" do processo: tipo, fundamento legal, registro
  // de preço, autoridade competente, comissão e data da autorização, que o
  // relatório só trazia como o número da contratação. Só entram os que vierem
  // preenchidos (nomes dos campos vistos no objeto `contratacao`, 2026-10-29).
  const formaContratacaoMapeada = [
    ['Forma de contratação (tipo)', 'formaContratacao', contratacao.formaContratacaoDesc || contratacao.formaContratacao],
    ['Fundamento legal', 'fundamentacaoLegal', contratacao.fundamentacaoLegal],
    ['Registro de preço', 'registroPreco', contratacao.registroPreco],
    ['Modo de disputa', 'modoDisputa', contratacao.modoDisputa],
    ['Número da chamada pública', 'numeroChamadaPublica', contratacao.numeroChamadaPublica],
    ['Autoridade competente', 'autoridadeCompetente', contratacao.responsavel],
    ['Comissão julgadora', 'membroComissao', contratacao.membroComissao],
    ['Data da autorização', 'dataAutorizacaoAdesaoAtaRegPreco', contratacao.dataAutorizacaoAdesaoAtaRegPreco],
  ]
  const formaContratacao = formaContratacaoMapeada
    .filter(([, , valor]) => valor != null && valor !== '')
    .map(([label, chave, valor]) => ({ label, valor: typeof valor === 'boolean' ? (valor ? 'Sim' : 'Não') : valorProcesso(chave, valor, p) }))
  // Demais dados que a tela "Forma de contratação" mostra (comissão julgadora
  // com os membros, datas de recebimento/abertura dos envelopes, número da
  // chamada…) e que o GET `contratacao` devolve: entram os que vierem
  // preenchidos e ainda não aparecem acima, com o nome do campo da API.
  const jaMostradas = new Set([
    ...formaContratacaoMapeada.map(([, chave]) => chave),
    'responsavel',
    'id',
    'entidade',
    'processoAdministrativo',
    'formaContratacaoDesc',
    'modalidade',
    'numeroSequencial',
    'anoSequencial',
  ])
  for (const [chave, valor] of Object.entries(contratacao)) {
    if (jaMostradas.has(chave) || valor == null || valor === '' || (Array.isArray(valor) && !valor.length)) continue
    formaContratacao.push({
      label: ROTULOS_CONTRATACAO[chave] || formatarChave(chave),
      valor: typeof valor === 'boolean' ? (valor ? 'Sim' : 'Não') : valorProcesso(chave, valor, p),
    })
  }
  principais.push(...formaContratacao)
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

// A tela de itens mostra unidade, valor unitário e valor total, mas na API esses
// dados vêm dentro de objetos aninhados (`especificacao.unidadeMedida`,
// `configuracao.valorUnitario`) — formato visto no item do processo 246/2026
// (2026-10-29). Sobe cada um para uma chave própria (sem sobrescrever uma que
// já exista), pra virar coluna da tabela.
function completarItemDaTela(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const completo = { ...raw }
  const unidade = (raw.especificacao && raw.especificacao.unidadeMedida) || raw.unidadeMedida
  if (completo.unidade == null && unidade != null) completo.unidade = unidade
  const configuracao = raw.configuracao && typeof raw.configuracao === 'object' ? raw.configuracao : {}
  if (completo.valorUnitario == null && configuracao.valorUnitario != null) completo.valorUnitario = configuracao.valorUnitario
  if (completo.valorTotal == null) {
    const total = raw.total != null ? raw.total : configuracao.valorTotal
    if (total != null) completo.valorTotal = total
  }
  return completo
}

// Tabela com até MAX_COLUNAS_TABELA colunas escolhidas pelos dados presentes
// (preferidas primeiro, depois as demais na ordem em que aparecem).
// `omitidas` diz quantas colunas ficaram de fora, pro PDF avisar que o Excel
// tem o resto. `p` é o processo dono dos registros (ver valorProcesso).
export function montarTabelaGenerica(registrosOriginais, excluir = [], p = null) {
  if (!Array.isArray(registrosOriginais) || !registrosOriginais.length) return { colunas: [], linhas: [], omitidas: 0 }
  const registros = registrosOriginais.map(completarItemDaTela)

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

// Proposta de um participante (`participantes/{id}/propostas/itens`): é uma
// linha por item, com o processo, o participante e o item repetidos por dentro
// (centenas de caracteres de JSON). A tela mostra item, unidade, quantidade,
// valores, classificação ("1º") e situação ("Venceu"), então esses saem em
// campos próprios (formato visto no processo 246/2026, 2026-10-29) e os
// objetos aninhados repetidos ficam de fora; o resto segue como veio.
const CHAVES_PROPOSTA_ANINHADAS = ['classificacao', 'item', 'participante', 'processoAdministrativo', 'participanteId', 'participanteNome']

function camposProposta(proposta, p) {
  const classificacao = proposta.classificacao && typeof proposta.classificacao === 'object' ? proposta.classificacao : {}
  const item = proposta.item && typeof proposta.item === 'object' ? proposta.item : {}
  const itemParticipante = classificacao.itemParticipante && typeof classificacao.itemParticipante === 'object' ? classificacao.itemParticipante : {}
  const itemDoProcesso = item.numero != null ? item : itemParticipante.item || {}
  const material = itemDoProcesso.material || {}
  const especificacao = itemDoProcesso.especificacao || {}
  const descricaoItem = material.descricao || especificacao.nome || ''
  const unidade = especificacao.unidadeMedida || itemDoProcesso.unidadeMedida
  const situacao = classificacao.situacaoDesc || proposta.situacaoDesc || proposta.situacao || ''
  const dados = [
    { label: 'Item', valor: [itemDoProcesso.numero, descricaoItem].filter((v) => v != null && v !== '').join(' - ') },
    { label: 'Unidade', valor: unidade ? valorProcesso('unidade', unidade, p) : '' },
    { label: 'Quantidade', valor: proposta.quantidade ?? itemDoProcesso.quantidade ?? '' },
    { label: 'Valor unitário (R$)', valor: formatarValor(proposta.valorUnitarioPercentual ?? classificacao.valor) },
    { label: 'Valor total (R$)', valor: formatarValor(proposta.valorTotal) },
    { label: 'Classificação', valor: classificacao.colocacao != null ? `${classificacao.colocacao}º` : '' },
    { label: 'Situação', valor: situacao },
    { label: 'Tipo de participação', valor: itemDoProcesso.tipoParticipacao || '' },
  ]
  const usadas = new Set(['quantidade', 'valorUnitarioPercentual', 'valorTotal', 'situacao', 'situacaoDesc', ...CHAVES_PROPOSTA_ANINHADAS])
  const demais = camposDe(proposta, p, [...usadas]).filter((campo) => campo.valor !== '')
  return [...dados, ...demais]
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
        campos: camposProposta(proposta, p),
      })
    })

    return {
      chave: 'participante',
      titulo: `${rotulo} do ${base}`,
      blocos,
      blocosParticipante: blocos.slice(0, 1),
      propostas: montarTabelaPropostas(dele, p),
    }
  })
}

// Propostas do participante em lista (uma linha por item, como as tabelas de
// itens dos outros relatórios): colunas = campos de camposProposta, na ordem em
// que aparecem, até MAX_COLUNAS_TABELA.
function montarTabelaPropostas(propostas, p) {
  const campos = propostas.map((proposta) => camposProposta(proposta, p))
  const colunas = []
  for (const lista of campos) {
    for (const { label } of lista) if (!colunas.includes(label)) colunas.push(label)
  }
  const escolhidas = colunas.slice(0, MAX_COLUNAS_TABELA)
  return {
    colunas: escolhidas,
    linhas: campos.map((lista) =>
      escolhidas.map((label) => {
        const campo = lista.find((c) => c.label === label)
        return campo && campo.valor != null ? String(campo.valor) : ''
      }),
    ),
    omitidas: colunas.length - escolhidas.length,
  }
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
      tabelaHistorico: chave === 'historico' ? montarTabelaHistoricoProcesso(registros, p) : null,
      blocos: [
        ...registros.map((raw, index) => {
          if (chave === 'textos') return { titulo: tituloBlocoTexto(raw, index), campos: camposTextoProcesso(raw, p) }
          if (chave === 'atassessao') return { titulo: `${singular} ${index + 1}`, campos: camposAtaSessao(raw, p) }
          const campos = camposDe(raw, p, ocultar)
          if (chave === 'sessoesjulgamento') campos.push(...camposDetalheSessao(raw, p))
          return { titulo: `${singular} ${index + 1}`, campos }
        }),
        ...(chave === 'despesas' ? blocoResumoDespesas(registros, p) : []),
      ],
    }))
}

function tamanhoArquivo(bytes) {
  const n = Number(bytes)
  if (!n || Number.isNaN(n)) return ''
  return n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

// Ata da sessão de julgamento (`sessoesjulgamento/atasprocesso`, formato visto
// em 2026-10-30): sequencial, tipo da ata, texto (HTML do editor) e arquivos;
// a sessão vem aninhada com membros e andamento, que ficam de fora daqui (o
// documento de sessões os mostra).
function camposAtaSessao(raw, p) {
  const sessao = raw && raw.sessaoJulgamento && typeof raw.sessaoJulgamento === 'object' ? raw.sessaoJulgamento : {}
  const tipoSessao = rotuloCadastro(sessao.tipoSessaoJulgamento)
  const arquivos = (Array.isArray(raw && raw.arquivos) ? raw.arquivos : [])
    .map((a) => [a.nome, tamanhoArquivo(a.tamanho)].filter(Boolean).join(' — '))
    .filter(Boolean)
    .join('; ')
  return [
    { label: 'Sequencial', valor: raw && raw.sequencial != null ? raw.sequencial : '' },
    { label: 'Tipo da ata', valor: rotuloCadastro(raw && raw.tipoAta) },
    { label: 'Sessão', valor: [sessao.numeroSessao, tipoSessao].filter((v) => v != null && v !== '').join(' - ') },
    { label: 'Situação da sessão', valor: sessao.situacaoAtualDesc || '' },
    { label: 'Texto da ata', valor: raw && raw.textoAta ? conteudoTexto(raw.textoAta) : '' },
    { label: 'Arquivos', valor: arquivos },
  ].filter((campo) => campo.valor !== '' && campo.valor != null)
}

// Membros e andamento da sessão de julgamento, que a lista de sessões traz
// vazios: vêm da sessão aninhada nas atas (`atassessao`), ligada pelo id.
function camposDetalheSessao(sessao, p) {
  const ata = subrecurso(p, 'atassessao').find((a) => a && a.sessaoJulgamento && String(a.sessaoJulgamento.id) === String(sessao && sessao.id))
  const detalhe = ata && ata.sessaoJulgamento
  if (!detalhe) return []
  const membros = (detalhe.sessaoJulgamentoMembro || []).map((m) => descreverPessoa(m.comissaoLicitacaoMembro)).filter(Boolean).join(', ')
  const andamento = (detalhe.sessaoJulgamentoAndamento || [])
    .map((a) => [valorProcesso('dataHoraAndamento', a.dataHoraAndamento, p), a.situacaoAndamentoDesc || a.situacao].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join('; ')
  return [
    { label: 'Membros da sessão', valor: membros },
    { label: 'Andamento da sessão', valor: andamento },
  ].filter((campo) => campo.valor)
}

// Rodapé da tela "Despesas": saldo remanescente (soma do valor estimado das
// despesas), total estimado dos itens e a diferença entre os dois.
function blocoResumoDespesas(despesas, p) {
  const soma = despesas.reduce((total, d) => total + (Number(d && d.valorEstimado) || 0), 0)
  const totalItens = Number(p && p.valorTotalItens)
  if (!despesas.length || Number.isNaN(totalItens)) return []
  return [
    {
      titulo: 'resumo das despesas',
      campos: [
        { label: 'Saldo remanescente', valor: `R$ ${formatarValor(soma)}` },
        { label: 'Total estimado dos itens', valor: `R$ ${formatarValor(totalItens)}` },
        { label: 'Diferença', valor: `R$ ${formatarValor(soma - totalItens)}` },
      ],
    },
  ]
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

// Quantidade com até 3 casas, sem zeros à direita ("6.295", "1.070,5").
function formatarQuantidade(v) {
  const n = Number(v)
  if (v == null || v === '' || Number.isNaN(n)) return ''
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

// Itens da ata (`atasregistropreco/{id}/itens`), no formato visto em
// 2026-10-30: o número do item e a unidade ficam aninhados
// (`processoAdministrativoItemGerado.numero`, `material.unidadeCompra.simbolo`)
// e o saldo/contratado no próprio item. Colunas da tela "Itens" da ata, mais o
// contratado e o saldo — a tabela genérica deixava de fora o número e a unidade.
export function montarTabelaItensAta(itens) {
  if (!Array.isArray(itens) || !itens.length) return { colunas: [], linhas: [], omitidas: 0 }
  const numeroDe = (it) => (it && it.processoAdministrativoItemGerado && it.processoAdministrativoItemGerado.numero) ?? ''
  const ordenados = [...itens].sort((a, b) => Number(numeroDe(a)) - Number(numeroDe(b)))
  const texto = (v) => (v == null ? '' : String(v))
  return {
    colunas: ['Item', 'Material', 'Marca', 'Unidade', 'Quantidade', 'Valor unitário (R$)', 'Valor total (R$)', 'Qtd. contratada', 'Saldo (qtd.)', 'Situação'],
    linhas: ordenados.map((it) => {
      const material = it.material && typeof it.material === 'object' ? it.material : {}
      const unidade = material.unidadeCompra && typeof material.unidadeCompra === 'object' ? material.unidadeCompra.simbolo : ''
      return [
        texto(numeroDe(it)),
        texto(material.descricao || (it.materialEspecificacao && it.materialEspecificacao.nome)),
        texto(it.descricaoMarca),
        texto(unidade),
        formatarQuantidade(it.quantidade),
        formatarValor(it.valorUnitario),
        formatarValor(it.valorTotal),
        formatarQuantidade(it.quantidadeContratada),
        formatarQuantidade(it.valorSaldo),
        texto(it.situacaoDesc || it.situacao),
      ]
    }),
    omitidas: 0,
  }
}

// CPF/CNPJ do fornecedor da ata: a lista de atas da tela mostra "NOME (CNPJ)",
// mas o relatório só trazia o nome. O nome do campo na API não foi mapeado,
// então tenta os lugares usuais; sem nenhum, não acrescenta o campo.
function documentoFornecedor(raw) {
  const f = raw && raw.fornecedor && typeof raw.fornecedor === 'object' ? raw.fornecedor : {}
  const pessoa = f.pessoa && typeof f.pessoa === 'object' ? f.pessoa : {}
  const doc = pessoa.cpfCnpj || pessoa.cnpj || pessoa.cpf || f.cpfCnpj || f.cnpj || f.cpf || raw.cpfCnpjFornecedor || ''
  // Formato visto em `atasregistropreco` (2026-10-30): fornecedor.pessoa.cpfCnpj,
  // só dígitos ("59783143000160") — a tela mostra "59.783.143/0001-60".
  return doc ? formatarCpfCnpj(doc) : ''
}

// Campos da ata na ordem da API, com valores monetários formatados
// ("R$ 1.234,56") e o CPF/CNPJ do fornecedor logo depois dele.
function camposAta(raw, p) {
  const chaves = Object.keys(raw || {}).filter((k) => k !== 'itensAta' && k !== 'ocorrencias')
  const documento = documentoFornecedor(raw)
  const campos = []
  chaves.forEach((chave) => {
    const valor = raw[chave]
    const texto = valorProcesso(chave, valor, p)
    const monetario = ehChaveMonetaria(chave) && valor != null && valor !== '' && !Number.isNaN(Number(valor))
    campos.push({ label: formatarChave(chave), valor: monetario ? `R$ ${formatarValor(valor)}` : texto })
    if (chave === 'fornecedor' && documento) campos.push({ label: 'CPF/CNPJ do fornecedor', valor: documento })
  })
  return campos
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
      // Valores monetários da ata (ex.: valorTotalItens) saíam crus, sem
      // separadores nem R$ — formatados como "R$ 1.234,56".
      campos: camposAta(raw, p),
      itens: montarTabelaItensAta(itens),
      ocorrencias: montarTabelaGenerica(Array.isArray(raw && raw.ocorrencias) ? raw.ocorrencias : [], [], p),
      tabelaAnexados: montarTabelaHistoricoAnexos(raw && raw.arquivos),
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

