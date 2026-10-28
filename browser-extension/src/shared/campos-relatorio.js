// Lista de campos do relatório de um contrato — compartilhada entre o popup
// (pré-visualização, se um dia precisar) e a página de relatório/PDF.
// Mesmo conjunto de campos do relatório em Excel gerado pela Central de Dados
// (backend/src/routes/contratos.ts), pra manter os dois relatórios consistentes.
function formatarNumeroContrato(c) {
  if (c.numeroTermo != null) return c.ano ? `${c.numeroTermo}/${c.ano}` : String(c.numeroTermo)
  if (c.sequencial != null) return `Seq. ${c.sequencial}`
  return ''
}

// Descrição do documento do contrato — pedido do usuário: "contrato 12/2026"
// pro contrato de número de termo 12, ano 2026 (sem a palavra "relatório").
// Usada como título dentro do PDF e como base do nome do arquivo.
export function tituloContrato(c) {
  const numero = formatarNumeroContrato(c)
  return numero ? `contrato ${numero}` : 'contrato'
}

export function montarCamposRelatorio(c) {
  const numero = formatarNumeroContrato(c)
  const tipoInstrumento = c.tipoInstrumento || {}
  const fornecedorPessoa = (c.fornecedor && c.fornecedor.pessoa) || {}
  const entidade = c.entidade || {}
  const processo = c.processoAdministrativo || {}

  return [
    { label: 'Sequencial', valor: c.sequencial ?? '' },
    { label: 'Número/Ano', valor: numero },
    { label: 'Tipo de instrumento', valor: tipoInstrumento.descricao || '' },
    { label: 'Situação', valor: c.situacaoDesc || c.situacao || '' },
    { label: 'Objeto', valor: c.objetoContratacao || '' },
    { label: 'Fornecedor', valor: fornecedorPessoa.nome || '' },
    { label: 'CPF/CNPJ do fornecedor', valor: fornecedorPessoa.cpfCnpj || '' },
    { label: 'Entidade', valor: entidade.nome || '' },
    { label: 'CNPJ da entidade', valor: entidade.cnpj || '' },
    { label: 'Processo administrativo', valor: processo.numero != null ? `${processo.numero}/${processo.ano ?? ''}` : '' },
    { label: 'Data de assinatura', valor: formatarData(c.dataAssinatura) },
    { label: 'Início da vigência', valor: formatarData(c.dataInicioVigencia) },
    { label: 'Fim da vigência', valor: formatarData(c.dataFimVigencia) },
    { label: 'Valor original (R$)', valor: formatarValor(c.valorOriginal) },
    { label: 'Valor de aditivos (R$)', valor: formatarValor(c.valorAditivos) },
    { label: 'Valor de solicitações de fornecimento (R$)', valor: formatarValor(c.valorSolFornec) },
    { label: 'Quantidade de itens', valor: Array.isArray(c.itens) ? c.itens.length : 0 },
    { label: 'Quantidade de aditivos', valor: Array.isArray(c.aditivos) ? c.aditivos.length : 0 },
    { label: 'Quantidade de apostilamentos', valor: Array.isArray(c.apostilamentos) ? c.apostilamentos.length : 0 },
    { label: 'Quantidade de rescisões', valor: Array.isArray(c.rescisoes) ? c.rescisoes.length : 0 },
  ]
}

// Colunas fixas do relatório de itens (pedido do usuário: só isso interessa,
// não o restante do catálogo bruto do Betha). Cada campo tenta várias chaves
// candidatas, em ordem — `qtdItem`/`valorItem`/`valorTotal`/`unidadeMedida`
// confirmados ao vivo pelo usuário (2026-09-16, item de aditivo); "Nº do
// item"/"Descrição" ainda não, mantidos como palpite defensivo. `extrair` tem
// prioridade sobre `chaves` quando presente — usado pros dois campos que só
// existem aninhados num sub-objeto (confirmado ao vivo pelo usuário,
// 2026-09-16, item do contrato em si, não de aditivo):
// unidadeMedida.simbolo (ex.: "MES") e itemPropostaBO.valorUnitarioPercentual.
// No item de ADITIVO, `unidadeMedida` vem como string pronta (ex.: "UN",
// confirmado ao vivo pelo usuário, 2026-09-23), com o objeto completo só em
// especificacao.unidadeMedida — por isso o extrator aceita os dois formatos.
function extrairUnidade(raw) {
  const u = raw.unidadeMedida
  if (typeof u === 'string' && u.trim()) return u.trim()
  if (u && typeof u === 'object' && u.simbolo) return u.simbolo
  const daEspecificacao = raw.especificacao && raw.especificacao.unidadeMedida
  return daEspecificacao && typeof daEspecificacao === 'object' ? daEspecificacao.simbolo : undefined
}

const CAMPOS_ITEM = [
  { header: 'Nº do item', chaves: ['numero', 'numeroItem', 'item', 'ordem'] },
  { header: 'Descrição', chaves: ['material', 'especificacao', 'descricaoItem', 'descricao'] },
  {
    header: 'Unidade',
    chaves: ['unidade', 'unidade_medida', 'undMedida'],
    extrair: extrairUnidade,
  },
  { header: 'Quantidade', chaves: ['qtdItem', 'quantidade', 'qtde', 'qtd'] },
  {
    header: 'Valor unitário (R$)',
    // `vlUnitario` confirmado ao vivo pelo usuário (2026-09-17, item de
    // recebimento) — chave própria desse sub-recurso, diferente das demais.
    chaves: ['valorItem', 'valorUnitario', 'valorUnit', 'precoUnitario', 'vlUnitario'],
    extrair: (raw) => raw.itemPropostaBO && raw.itemPropostaBO.valorUnitarioPercentual,
    moeda: true,
  },
  // `vlTotal` confirmado ao vivo pelo usuário (2026-09-17, item de
  // recebimento) — chave própria desse sub-recurso, diferente das demais.
  { header: 'Valor total (R$)', chaves: ['valorTotal', 'valor', 'vlTotal'], moeda: true },
]

function extrairCampoItem(raw, campo) {
  if (!raw || typeof raw !== 'object') return undefined
  if (campo.extrair) {
    const viaExtrator = campo.extrair(raw)
    if (viaExtrator !== undefined && viaExtrator !== null) return viaExtrator
  }
  for (const chave of campo.chaves) {
    if (raw[chave] !== undefined) return raw[chave]
  }
  return undefined
}

// Tabela de itens (do contrato ou de um aditivo) com as colunas FIXAS acima
// — usada pros itens do contrato e de cada aditivo.
export function montarTabelaItens(registros) {
  if (!Array.isArray(registros) || !registros.length) return { colunas: [], linhas: [] }
  return {
    colunas: CAMPOS_ITEM.map((c) => c.header),
    linhas: registros.map((raw) =>
      CAMPOS_ITEM.map((c) => {
        const bruto = extrairCampoItem(raw, c)
        return c.moeda ? formatarValor(bruto) : valorTexto(bruto)
      }),
    ),
  }
}

// Melhor palpite de um identificador próprio do aditivo — mesma lógica do
// backend (extrairIdentificadorAditivo em contratos.ts), pra ordenar os
// aditivos cronologicamente pelo sequencial antes de numerá-los.
function extrairIdentificadorAditivo(raw) {
  const v = raw && (raw.sequencial ?? raw.id)
  const n = Number(v)
  return v != null && !Number.isNaN(n) ? n : null
}

// Cada aditivo vira uma SEÇÃO própria, numerada na ordem CRONOLÓGICA do
// sequencial (não a ordem em que a API devolveu) — identificada também pelo
// sequencial/id do próprio aditivo, quando existir. Os itens vinculados ao
// aditivo (se houver) viram uma tabela própria logo abaixo dos campos dele —
// nunca misturados com os do contrato ou de outro aditivo.
export function montarSecoesAditivos(aditivos) {
  return montarSecoesAlteracao(aditivos, 'aditivo')
}

// Apostilamentos — a outra alteração contratual além do aditivo (pedido do
// usuário, 2026-10-21: considerar todas as alterações contratuais). Mesma
// estrutura e ordenação do aditivo; título "apostilamento 1".
export function montarSecoesApostilamentos(apostilamentos) {
  return montarSecoesAlteracao(apostilamentos, 'apostilamento')
}

// Rescisões contratuais — também alteração contratual (pedido do usuário,
// 2026-10-27). Mesma estrutura e ordenação do apostilamento; título
// "rescisão 1".
export function montarSecoesRescisoes(rescisoes) {
  return montarSecoesAlteracao(rescisoes, 'rescisão')
}

function montarSecoesAlteracao(registros, rotulo) {
  if (!Array.isArray(registros) || !registros.length) return []

  const ordenados = registros
    .map((raw, indiceOriginal) => ({ raw, indiceOriginal, chave: extrairIdentificadorAditivo(raw) ?? Infinity }))
    .sort((a, b) => a.chave - b.chave || a.indiceOriginal - b.indiceOriginal)
    .map((x) => x.raw)

  return ordenados.map((raw, index) => {
    const identificador = extrairIdentificadorAditivo(raw)
    const numero = index + 1
    // Descrição do documento — pedido do usuário: "aditivo 1" pro aditivo de
    // número sequencial 1 (sem a palavra "relatório"). Usa o sequencial do
    // próprio registro quando existir; cai pra posição cronológica só quando
    // o Betha não trouxe nenhum identificador próprio.
    const titulo = `${rotulo} ${identificador ?? numero}`

    const { itens, ...demaisCampos } = raw || {}
    const campos = camposDinamicos(demaisCampos, raw)
    const tabelaItens = montarTabelaItens(itens)

    return { numero, titulo, campos, tabelaItens }
  })
}

// Cada solicitação de fornecimento vinculada ao contrato vira uma SEÇÃO
// própria — mostra TODOS os campos que a API devolve (pedido do usuário:
// "todas as informações"), sem recorte pra um subconjunto fixo (diferente de
// CAMPOS_ITEM). Já vem ordenada pela própria API (`sort: data desc`), não
// reordenamos aqui. `numeroAno` já é o número formatado pelo próprio Betha
// (ex.: "2373/2026") — confirmado no projeto irmão Delta Intelligence
// (CONTEXTO_PROJETO.md §5). Os itens vinculados à solicitação viram uma
// tabela própria logo abaixo dos campos (mesmas colunas fixas dos itens de
// contrato/aditivo, ver montarTabelaItens); `itens` e `recebimentos` (este com
// documento próprio, ver montarSecoesRecebimentos) não entram como campo.
export function montarSecoesSolicitacoesFornecimento(solicitacoes) {
  if (!Array.isArray(solicitacoes) || !solicitacoes.length) return []

  return solicitacoes.map((raw, index) => {
    const numero = (raw && (raw.numeroAno || (raw.numero != null ? String(raw.numero) : null))) || null
    // Descrição do documento — pedido do usuário: "solicitação de
    // fornecimento 197/2026" pra solicitação 197 de 2026 (sem a palavra
    // "relatório").
    const titulo = `solicitação de fornecimento ${numero ?? index + 1}`
    const { itens, recebimentos: _recebimentos, ...demaisCampos } = raw || {}
    const campos = camposDinamicos(demaisCampos, raw)
    const tabelaItens = montarTabelaItens(itens)
    return { titulo, campos, tabelaItens }
  })
}

// Cada interação contábil (empenhar/liquidar/pagar) vinculada ao contrato
// vira uma SEÇÃO própria — mesmo estilo das solicitações de fornecimento:
// mostra TODOS os campos que a API devolve, sem recorte pra um subconjunto
// fixo (o `desdobramento` interno já vem com o essencial de cada rateio
// orçamentário e é exibido por completo via valorTexto). Não há um
// "número/ano" formatado como o de solicitação de fornecimento — usa
// `sequencial` (posição da interação dentro do contrato) + o tipo de ação
// (Empenhar/Liquidar/Pagar) pra identificar cada uma no título.
export function montarSecoesInteracoesContabilidade(interacoes) {
  if (!Array.isArray(interacoes) || !interacoes.length) return []

  return interacoes.map((raw, index) => {
    const identificador = (raw && raw.sequencial) ?? index + 1
    const tipoAcao = raw && (raw.tipoAcaoDesc || raw.tipoAcao)
    const titulo = `interação contábil ${identificador}${tipoAcao ? ` (${tipoAcao})` : ''}`
    const campos = []
    const contexto = { entidades: indexarEntidades(raw) }
    for (const [chave, valor] of Object.entries(raw || {})) {
      // `contratacao` vira "Sequencial da contratação" — só o sequencial
      // (injetado por popup.js, ver enriquecerSequenciaisContratacao), não o
      // objeto cru com flags/id interno que o Betha devolve.
      if (chave === 'contratacao') {
        campos.push({
          label: 'Sequencial da contratação',
          valor: valor && typeof valor === 'object' && valor.sequencial != null ? String(valor.sequencial) : '',
        })
        continue
      }
      campos.push({ label: formatarChave(chave), valor: valorCampoDinamico(chave, valor, contexto) })
      // Campo extra "Despesa" logo após "Desdobramento" — pedido do usuário
      // (2026-09-22): o número da despesa (ex.: 291), não o id interno
      // (`despesa.id`) que já aparece dentro de cada rateio. Não é uma chave
      // própria do retorno da Betha; é sintetizado aqui a partir de
      // `despesa.numero` que popup.js injeta em cada item de
      // `desdobramento` (ver enriquecerNumerosDespesa).
      if (chave === 'desdobramento') {
        campos.push({ label: 'Despesa', valor: valorNumeroDespesa(valor) })
        campos.push({ label: 'Número/ano do empenho', valor: valorNumeroEmpenho(raw) })
      }
    }
    return { titulo, campos }
  })
}

// Campos de UM recebimento — TODOS os que a API devolver, sem recorte pra um
// subconjunto fixo. Pedido do usuário (2026-09-17): a tela "Editando
// recebimento" do Betha mostra bem mais do que as colunas da listagem
// (desconto, retenção tributária, provisório e datas, observações,
// comprovantes com nota fiscal/saldo/valor) — um recorte fixo perderia
// qualquer um desses campos que a listagem eventualmente trouxer. Mesmo
// estilo de montarSecoesSolicitacoesFornecimento: `comprovantes`/`arquivos`
// (arrays de objetos) já caem no fallback genérico de valorTexto. `itens` é
// excluído daqui — vira tabela própria (ver montarTabelaItens), não faz
// sentido como um campo de texto genérico. `solFornec`/`solicitacaoFornecimento`
// também ficam de fora (pedido do usuário, 2026-10-23): a solicitação já está
// no título do documento ("recebimentos da solicitação de fornecimento X").
function montarCamposRecebimento(raw) {
  const { itens: _itens, solFornec: _solFornec, solicitacaoFornecimento: _solicitacao, ...demaisCampos } = raw || {}
  return camposDinamicos(demaisCampos, raw)
}

// Recebimentos vinculados a CADA solicitação de fornecimento viram uma
// seção própria numa aba específica de "Recebimentos" — pedido do usuário
// (2026-09-17): separados da seção de solicitações de fornecimento, mas
// identificando a qual solicitação cada grupo pertence. Dentro da seção,
// cada recebimento é seu próprio bloco com todos os campos (ver
// montarCamposRecebimento) e, logo abaixo, os itens efetivamente recebidos
// (mesma tabela de colunas fixas dos itens de contrato/aditivo — pedido do
// usuário, 2026-09-17). Só gera seção pra solicitação que efetivamente tem
// recebimento.
export function montarSecoesRecebimentos(solicitacoes) {
  if (!Array.isArray(solicitacoes) || !solicitacoes.length) return []

  return solicitacoes
    .filter((sf) => Array.isArray(sf && sf.recebimentos) && sf.recebimentos.length)
    .map((sf) => {
      const numero = (sf.numeroAno || (sf.numero != null ? String(sf.numero) : null)) ?? sf.id
      const titulo = `recebimentos da solicitação de fornecimento ${numero}`
      const recebimentos = sf.recebimentos.map((raw, index) => ({
        titulo: `recebimento ${(raw && raw.numero) ?? index + 1}`,
        campos: montarCamposRecebimento(raw),
        tabelaItens: montarTabelaItens(raw && raw.itens),
      }))
      return { titulo, recebimentos }
    })
}

// Documento "publicação contrato 12/2026" (pedido do usuário, 2026-10-19) —
// um por contratação, gerado mesmo sem publicação cadastrada (aí `blocos` vem
// vazio e o documento avisa). Cada publicação da janela "Publicação" do
// Betha vira um bloco com TODOS os campos que a API devolveu (catálogo não
// confirmado ao vivo, mesmo princípio das solicitações de fornecimento).
export function tituloPublicacoes(c) {
  return `publicação ${tituloContrato(c)}`
}

export function montarDocumentoPublicacoes(c) {
  const publicacoes = Array.isArray(c.publicacoes) ? c.publicacoes : []
  return {
    titulo: tituloPublicacoes(c),
    blocos: publicacoes.map((raw, index) => ({
      titulo: `publicação ${index + 1}`,
      campos: camposDinamicos(raw, raw),
    })),
  }
}

// Documento "textos contrato 12/2026" (pedido do usuário, 2026-10-21) — os
// registros da rotina "Textos" ("Listando textos") da contratação, um bloco
// por texto com TODOS os campos que a API devolveu (título, tipo, conteúdo,
// arquivos anexados…). Gerado sempre, um por contratação, mesmo sem textos
// (aí `blocos` vem vazio e o documento avisa) — mesmo princípio das
// publicações. Os arquivos em si vão na pasta de anexos do zip.
export const MENSAGEM_SEM_TEXTOS = 'Sem textos cadastrados'

export function tituloTextos(c) {
  return `textos ${tituloContrato(c)}`
}

export function montarDocumentoTextos(c) {
  const textos = Array.isArray(c.textos) ? c.textos : []
  // Entidades só com id resolvidas pelo contrato inteiro (o próprio
  // `c.entidade` traz o nome).
  const contexto = { entidades: indexarEntidades(c) }
  return {
    titulo: tituloTextos(c),
    blocos: textos.map((raw, index) => ({ titulo: tituloBlocoTexto(raw, index), campos: camposTexto(raw, contexto) })),
  }
}

// "texto 1 — Termo de Referência": o `titulo` do próprio texto, quando houver
// — mesmo título dos blocos de textos do processo.
export function tituloBlocoTexto(raw, index) {
  const titulo = raw && typeof raw.titulo === 'string' ? raw.titulo.trim() : ''
  return titulo ? `texto ${index + 1} — ${titulo}` : `texto ${index + 1}`
}

function camposTexto(raw, contexto) {
  return Object.entries(raw || {}).map(([chave, valor]) => {
    // `contratacao` vira "Sequencial da contratação" — só o sequencial
    // (injetado por popup.js, ver enriquecerSequenciaisContratacao), não o
    // objeto cru com o id interno (pedido do usuário, 2026-10-23).
    if (chave === 'contratacao') {
      return {
        label: 'Sequencial da contratação',
        valor: valor && typeof valor === 'object' && valor.sequencial != null ? String(valor.sequencial) : '',
      }
    }
    return {
      label: formatarChave(chave),
      valor: chave === 'conteudo' ? conteudoTexto(valor) : valorCampoDinamico(chave, valor, contexto),
    }
  })
}

// `conteudo` do texto vem do editor do Betha — pode ser HTML (parágrafos,
// quebras, negrito). No relatório vira texto corrido, uma linha por
// parágrafo, sem as tags. Texto sem tag nenhuma passa direto.
export function conteudoTexto(valor) {
  if (typeof valor !== 'string') return valorTexto(valor)
  if (!/<[a-z!/][^>]*>/i.test(valor)) return valor
  const entidades = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  return valor
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (original, codigo) => {
      if (codigo[0] === '#') {
        const n = codigo[1].toLowerCase() === 'x' ? parseInt(codigo.slice(2), 16) : parseInt(codigo.slice(1), 10)
        return Number.isNaN(n) || n > 0x10ffff ? original : String.fromCodePoint(n)
      }
      return entidades[codigo.toLowerCase()] ?? original
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Todos os campos de `campos` (label + valor exibido), com as entidades só
// com id resolvidas pelo que aparecer no registro inteiro (`raw`, que pode ter
// mais chaves do que as exibidas — ex.: os itens que viram tabela própria).
function camposDinamicos(campos, raw) {
  const contexto = { entidades: indexarEntidades(raw) }
  return Object.entries(campos || {}).flatMap(([chave, valor]) => {
    const campo = { label: formatarChave(chave), valor: valorCampoDinamico(chave, valor, contexto) }
    const codigo = ehChaveOrganograma(chave) ? codigoOrganograma(valor) : ''
    return codigo ? [campo, { label: 'Código do organograma', valor: codigo }] : [campo]
  })
}

// Responsáveis do contrato (fiscal, gestor etc.) em seção própria — pedido
// do usuário: nome, tipo e período de cada um, não misturados nos campos do
// contrato. Formato confirmado ao vivo pelo usuário (2026-09-17) contra o
// retorno real do sub-recurso `responsaveiscontratacao`: nome em
// `responsavel.pessoa.nome`, tipo em `tipoResponsavelContrato.descricao`,
// período em `dataInicioResponsabilidade`/`dataFinalResponsabilidade`.
// Aviso do documento "responsáveis do contrato X" quando não há nenhum —
// mesmo texto no PDF, na página do relatório e no Excel do backend.
export const MENSAGEM_SEM_RESPONSAVEIS = 'O contrato não tem responsáveis cadastrados'

export function montarTabelaResponsaveis(responsaveis) {
  if (!Array.isArray(responsaveis) || !responsaveis.length) return { colunas: [], linhas: [] }
  return {
    colunas: ['Responsável', 'Tipo', 'Período'],
    linhas: responsaveis.map((r) => {
      const pessoa = (r && r.responsavel && r.responsavel.pessoa) || {}
      const tipo = (r && r.tipoResponsavelContrato && r.tipoResponsavelContrato.descricao) || ''
      const periodo = formatarPeriodo(r && r.dataInicioResponsabilidade, r && r.dataFinalResponsabilidade)
      return [pessoa.nome || '', tipo, periodo]
    }),
  }
}

function formatarPeriodo(inicio, fim) {
  const dataInicio = formatarData(inicio)
  const dataFim = formatarData(fim)
  if (dataInicio && dataFim) return `${dataInicio} a ${dataFim}`
  if (dataInicio) return `A partir de ${dataInicio}`
  if (dataFim) return `Até ${dataFim}`
  return ''
}

export function formatarChave(chave) {
  return chave.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

// Datas SEMPRE em dd/mm/aaaa neste relatório — nunca ISO (aaaa-mm-dd).
function formatarDataBr(d) {
  const dia = String(d.getUTCDate()).padStart(2, '0')
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0')
  const ano = d.getUTCFullYear()
  return `${dia}/${mes}/${ano}`
}

// Detecta string de data ISO (ex.: "2025-06-01" ou "2025-06-01T00:00:00Z")
// entre os campos dinâmicos de aditivo/item — o catálogo desses sub-recursos
// não define tipos, então datas chegam como string solta.
function pareceDataIso(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(v)
}

// Simplifica objetos/listas comuns do Betha pra exibição em relatório — mostra
// só o dado que interessa em vez do objeto/array/string bruta. Ex.:
// - "2025-06-01T00:00:00Z" -> "01/06/2025"
// - contratacao: { numeroTermo, ano, ... } -> "86/2025"
// - tipoAditivo: { descricao, classificacao } -> "Aditivo de Prazo e Valor (Acréscimo)"
// - arquivos: [{ nome, id, tipo }, ...] -> "arquivo1.pdf, arquivo2.pdf"
export function valorTexto(v) {
  if (v == null) return ''
  if (pareceDataIso(v)) {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return formatarDataBr(d)
  }
  if (Array.isArray(v)) return v.map((item) => valorTexto(item)).join(', ')
  if (typeof v === 'object') {
    if (v.numeroTermo != null) return v.ano != null ? `${v.numeroTermo}/${v.ano}` : String(v.numeroTermo)
    if (v.descricao != null) return String(v.descricao)
    if (v.nome != null) return String(v.nome)
    // Fornecedor/responsável do Betha: o nome fica em `pessoa.nome` (ex.:
    // fornecedor da solicitação de fornecimento, pedido do usuário,
    // 2026-10-14) — sem isso cai no JSON.stringify do objeto inteiro.
    if (v.pessoa && typeof v.pessoa === 'object' && v.pessoa.nome != null) return String(v.pessoa.nome)
    // Objeto vazio (ex.: `protocolo: {}` do processo) não tem nada pra
    // conferir — fica em branco, igual a uma lista vazia.
    if (!Object.keys(v).length) return ''
    // Valor não reconhecido fica como JSON cru de propósito, pra um analista
    // conferir manualmente — não trocar por texto vazio/simplificado.
    return JSON.stringify(v)
  }
  return String(v)
}

// Campo "organograma" (unidade orçamentária) — pedido do usuário: além da
// descrição, mostrar também o código do organograma, que o fallback genérico
// de valorTexto descarta (mostra só `descricao`, igual faz pra tipoAditivo
// etc.). Restrito à chave "organograma" mesmo — não vale pra todo objeto que
// tiver um `codigo` solto, só pra esse campo específico.
function ehChaveOrganograma(chave) {
  return typeof chave === 'string' && /organograma/i.test(chave)
}

// Código do organograma como campo próprio ("Código do organograma"), logo
// abaixo do "Organograma" — pedido do usuário: a solicitação de fornecimento
// mostrava só a descrição. Confirmado no retorno real do Betha (2026-10-28): o
// objeto traz `numero` (ex.: "0200300203", sem máscara) além de `descricao`.
function codigoOrganograma(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return ''
  return valor.numero != null && typeof valor.numero !== 'object' ? String(valor.numero).trim() : ''
}

// Campo "desdobramento" de uma interação contábil (empenhar/liquidar/pagar) —
// pedido do usuário (2026-09-22): o Betha devolve, pra cada rateio
// orçamentário, um OBJETO cheio de metadados (empenho, natureza de despesa,
// arquivos...) e não só o número do desdobramento em si (ex.:
// "33903900000000"). O fallback genérico de valorTexto cai no
// JSON.stringify(v) desse objeto por não reconhecer nenhuma chave conhecida
// (numeroTermo/descricao/nome) — mostra o campo ilegível no relatório. Aqui
// extrai só `item.desdobramento` de cada rateio (pode vir mais de um, por
// isso o array), unindo por vírgula igual ao restante do relatório.
function ehChaveDesdobramento(chave) {
  return chave === 'desdobramento'
}

function valorDesdobramento(valor) {
  const lista = Array.isArray(valor) ? valor : [valor]
  return lista
    .map((item) => (item && typeof item === 'object' ? item.desdobramento : item))
    .filter((v) => v != null)
    .join(', ')
}

// Número da despesa (ex.: "291") de cada rateio — `despesa.numero` só existe
// quando popup.js já enriqueceu o item (ver enriquecerNumerosDespesa); sem
// isso o campo simplesmente fica em branco no relatório, nunca mostra o id
// interno (`despesa.id`) no lugar por engano.
function valorNumeroDespesa(valor) {
  const lista = Array.isArray(valor) ? valor : [valor]
  return lista
    .map((item) => (item && typeof item === 'object' && item.despesa ? item.despesa.numero : null))
    .filter((v) => v != null)
    .join(', ')
}

// Número/ano do empenho (ex.: 5426/2026) gerado quando a interação é
// contabilizada — pedido do usuário (2026-10-21), ano incluído a pedido de
// 2026-10-27. Confirmado no retorno real do Betha: cada rateio do
// `desdobramento` traz `empenhoContabilidadeBO.numeroEmpenho` (presente em
// empenhar/liquidar/pagar) e, só no "Empenhar", também `numeroEmpenho` direto
// no rateio. O ano vem em `empenhoContabilidadeBO.anoEmpenho` (confirmado no
// retorno real, em empenhar e liquidar); sem ele, mostra só o número.
// Interação não contabilizada fica em branco.
function interacaoContabilizada(raw) {
  const situacao = raw && (raw.situacao || raw.situacaoDesc)
  return typeof situacao === 'string' && /^contabilizad/i.test(situacao.trim())
}

function anoDoEmpenho(...origens) {
  for (const origem of origens) {
    const v = origem && typeof origem === 'object' ? origem.anoEmpenho : null
    if (typeof v === 'number' || (typeof v === 'string' && /^\d{4}$/.test(v.trim()))) return String(v).trim()
  }
  return null
}

function valorNumeroEmpenho(raw) {
  if (!interacaoContabilizada(raw)) return ''
  const lista = Array.isArray(raw.desdobramento) ? raw.desdobramento : []
  const empenhos = lista
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const bo = item.empenhoContabilidadeBO
      const origemNumero = bo && typeof bo === 'object' && bo.numeroEmpenho != null ? bo : item
      const numero = origemNumero.numeroEmpenho
      if (numero == null) return null
      const ano = anoDoEmpenho(bo, item)
      return ano ? `${numero}/${ano}` : String(numero)
    })
    .filter((v) => v != null)
  return [...new Set(empenhos)].join(', ')
}

// Campo "solicitacaoFornecimento" de uma interação contábil — pedido do
// usuário (2026-10-14): o Betha devolve o objeto inteiro da solicitação, mas
// só interessa o número/ano formatado (`numeroAno`, ex.: "4641/2025"). Sem
// isso o fallback genérico de valorTexto cai no JSON.stringify do objeto.
function ehChaveSolicitacaoFornecimento(chave) {
  return chave === 'solicitacaoFornecimento'
}

function valorSolicitacaoFornecimento(valor) {
  const lista = Array.isArray(valor) ? valor : [valor]
  return lista
    .map((item) => (item && typeof item === 'object' ? item.numeroAno : item))
    .filter((v) => v != null)
    .join(', ')
}

// Campo "aditivo" da solicitação de fornecimento — pedido do usuário
// (2026-10-23): o Betha devolve só `{ arquivos: [], id }`; popup.js completa
// com o aditivo da listagem de alterações (ver enriquecerAditivosSolicitacoes).
// Mostra o sequencial (o mesmo do documento "aditivo N"), o tipo, a data e o
// valor (pedido do usuário, 2026-10-23), ex.: "4 (Renovação Contratual) -
// 27/11/2025 - R$ 50.510,16". Data/valor ausentes simplesmente não aparecem.
// Sem sequencial (aditivo não resolvido) cai no valorTexto, que mantém o JSON
// cru pra conferência manual.
function ehChaveAditivo(chave) {
  return chave === 'aditivo'
}

function valorAditivo(valor) {
  if (valor.sequencial == null) return valorTexto(valor)
  const tipo = valor.tipoAditivo && valor.tipoAditivo.descricao
  const data = formatarData(valor.dataAditivoFonte || valor.dataAssinatura || valor.dataAditivo)
  const montante = valor.valorAditivo ?? valor.valor
  return [
    tipo ? `${valor.sequencial} (${tipo})` : String(valor.sequencial),
    data,
    montante != null ? `R$ ${formatarValor(montante)}` : '',
  ]
    .filter(Boolean)
    .join(' - ')
}

// Veículo de publicação (campo da publicação do contrato cuja chave contém
// "veiculo") — pedido do usuário (2026-10-19): o nome exibido é o do
// fornecedor do veículo, `fornecedor.pessoa.nome` (ex.: "MUNICIPIO DE ARROIO
// DO TIGRE"), formato confirmado ao vivo em `veiculospublicacao` do Compras.
// Veículo sem esse nome cai no valorTexto (e no JSON cru, se nada servir).
function ehChaveVeiculo(chave) {
  return typeof chave === 'string' && /veiculo/i.test(chave)
}

function nomeVeiculo(item) {
  const pessoa = item && typeof item === 'object' && item.fornecedor && item.fornecedor.pessoa
  return pessoa && pessoa.nome != null ? String(pessoa.nome) : valorTexto(item)
}

// Entidade (`entidade`, `entidadeContrato`, `entidadeParticipante`…) — o
// Betha costuma devolver só `{ id }` (ex.: "Entidade Contrato" da solicitação
// de fornecimento, "Entidade" do processo; confirmado nos relatórios gerados
// pelo usuário, 2026-10-21), mas o cadastro completo, com `nome`, aparece em
// outro ponto do mesmo registro (a própria `entidade` da solicitação, a
// entidade aninhada no histórico do processo...). `indexarEntidades` varre o
// registro inteiro e monta id -> nome só a partir de objetos sob chaves de
// entidade, pra não confundir com ids de outros cadastros.
function ehChaveEntidade(chave) {
  return typeof chave === 'string' && /^entidade/i.test(chave)
}

export function indexarEntidades(raiz) {
  const nomes = new Map()
  const visitar = (no, chave) => {
    if (Array.isArray(no)) {
      no.forEach((item) => visitar(item, chave))
      return
    }
    if (!no || typeof no !== 'object') return
    if (ehChaveEntidade(chave) && no.id != null && no.nome != null && !nomes.has(String(no.id))) {
      nomes.set(String(no.id), String(no.nome))
    }
    for (const [k, v] of Object.entries(no)) visitar(v, k)
  }
  visitar(raiz, '')
  return nomes
}

// `entidadeParticipante` (despesas do processo) embrulha a entidade em
// `{ entidade: { id }, orgaoExterno }`. Devolve null quando não resolve, pra
// cair no valorTexto (e no JSON cru).
function nomeEntidade(valor, entidades) {
  const alvo = valor.entidade && typeof valor.entidade === 'object' ? valor.entidade : valor
  if (alvo.nome != null) return String(alvo.nome)
  const nome = alvo.id != null && entidades ? entidades.get(String(alvo.id)) : undefined
  if (nome) return nome
  if (valor.orgaoExterno && typeof valor.orgaoExterno === 'object' && !valor.entidade) return valorTexto(valor.orgaoExterno)
  return null
}

// `contexto.entidades` vem de indexarEntidades (opcional — sem ele, entidade
// só com id fica como JSON cru).
export function valorCampoDinamico(chave, valor, contexto = {}) {
  if (ehChaveEntidade(chave) && valor && typeof valor === 'object' && !Array.isArray(valor)) {
    const nome = nomeEntidade(valor, contexto.entidades)
    if (nome != null) return nome
  }
  if (ehChaveSolicitacaoFornecimento(chave) && valor != null) {
    return valorSolicitacaoFornecimento(valor)
  }
  if (ehChaveAditivo(chave) && valor && typeof valor === 'object' && !Array.isArray(valor)) {
    return valorAditivo(valor)
  }
  if (ehChaveVeiculo(chave) && valor && typeof valor === 'object') {
    return Array.isArray(valor) ? valor.map(nomeVeiculo).join(', ') : nomeVeiculo(valor)
  }
  if (ehChaveOrganograma(chave) && valor && typeof valor === 'object' && !Array.isArray(valor)) {
    const descricao = valor.descricao != null ? String(valor.descricao) : ''
    const codigo = valor.codigo != null ? String(valor.codigo) : ''
    if (descricao && codigo) return `${descricao} (${codigo})`
  }
  if (ehChaveDesdobramento(chave) && valor != null) {
    return valorDesdobramento(valor)
  }
  return valorTexto(valor)
}

export function formatarData(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return formatarDataBr(d)
}

export function formatarValor(v) {
  if (v == null) return ''
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
