// Lista de campos do relatório de um contrato — compartilhada entre o popup
// (pré-visualização, se um dia precisar) e a página de relatório/PDF.
// Mesmo conjunto de campos do relatório em Excel gerado pela Central de Dados
// (backend/src/routes/contratos.ts), pra manter os dois relatórios consistentes.
export function montarCamposRelatorio(c) {
  const numero = c.numeroTermo != null
    ? (c.ano ? `${c.numeroTermo}/${c.ano}` : String(c.numeroTermo))
    : (c.sequencial != null ? `Seq. ${c.sequencial}` : '')
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
  ]
}

// Colunas fixas do relatório de itens (pedido do usuário: só isso interessa,
// não o restante do catálogo bruto do Betha). Cada campo tenta várias chaves
// candidatas, em ordem — `qtdItem`/`valorItem`/`valorTotal`/`unidadeMedida`
// confirmados ao vivo pelo usuário (2026-09-16, item de aditivo); "Nº do
// item"/"Descrição" ainda não, mantidos como palpite defensivo.
const CAMPOS_ITEM = [
  { header: 'Nº do item', chaves: ['numero', 'numeroItem', 'item', 'ordem'] },
  { header: 'Descrição', chaves: ['material', 'especificacao', 'descricaoItem', 'descricao'] },
  { header: 'Unidade', chaves: ['unidadeMedida', 'unidade', 'unidade_medida', 'undMedida'] },
  { header: 'Quantidade', chaves: ['qtdItem', 'quantidade', 'qtde', 'qtd'] },
  { header: 'Valor unitário (R$)', chaves: ['valorItem', 'valorUnitario', 'valorUnit', 'precoUnitario'], moeda: true },
  { header: 'Valor total (R$)', chaves: ['valorTotal', 'valor'], moeda: true },
]

function extrairCampoItem(raw, chaves) {
  if (!raw || typeof raw !== 'object') return undefined
  for (const chave of chaves) {
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
        const bruto = extrairCampoItem(raw, c.chaves)
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
  if (!Array.isArray(aditivos) || !aditivos.length) return []

  const ordenados = aditivos
    .map((raw, indiceOriginal) => ({ raw, indiceOriginal, chave: extrairIdentificadorAditivo(raw) ?? Infinity }))
    .sort((a, b) => a.chave - b.chave || a.indiceOriginal - b.indiceOriginal)
    .map((x) => x.raw)

  return ordenados.map((raw, index) => {
    const identificador = extrairIdentificadorAditivo(raw)
    const numero = index + 1
    const titulo = identificador != null ? `Aditivo ${numero} (seq. ${identificador})` : `Aditivo ${numero}`

    const { itens, ...demaisCampos } = raw || {}
    const campos = Object.entries(demaisCampos).map(([chave, valor]) => ({ label: formatarChave(chave), valor: valorTexto(valor) }))
    const tabelaItens = montarTabelaItens(itens)

    return { numero, titulo, campos, tabelaItens }
  })
}

function formatarChave(chave) {
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
function valorTexto(v) {
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
    return JSON.stringify(v)
  }
  return String(v)
}

function formatarData(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return formatarDataBr(d)
}

function formatarValor(v) {
  if (v == null) return ''
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
