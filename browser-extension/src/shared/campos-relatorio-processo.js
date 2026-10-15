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
import { formatarChave, formatarData, formatarValor, valorCampoDinamico } from './campos-relatorio.js'

// Valor exibido de um campo de processo/sub-recurso. Além do que
// `valorCampoDinamico` já simplifica (descricao/nome/pessoa.nome/datas…),
// objetos de unidade de medida do Betha vêm como `{ simbolo }` (ex.: "UN") e
// cairiam no JSON.stringify.
function valorProcesso(chave, valor) {
  if (valor && typeof valor === 'object' && !Array.isArray(valor) && valor.simbolo != null) return String(valor.simbolo)
  return valorCampoDinamico(chave, valor)
}

// Sub-recursos que viram TABELA dentro do PDF/relatório do próprio processo.
export const SUBRECURSOS_EM_TABELA = [
  { chave: 'itens', rotulo: 'Itens' },
  { chave: 'lotes', rotulo: 'Lotes' },
  { chave: 'participantes', rotulo: 'Participantes' },
]

// Sub-recursos que viram um DOCUMENTO próprio (um PDF cada), com todos os
// campos de cada registro — mesmo princípio dos aditivos/solicitações do
// contrato. `singular` nomeia cada bloco dentro do documento.
export const SUBRECURSOS_EM_DOCUMENTO = [
  { chave: 'pareceres', rotulo: 'pareceres', singular: 'parecer' },
  { chave: 'sessoesjulgamento', rotulo: 'sessões de julgamento', singular: 'sessão de julgamento' },
  { chave: 'atosfinais', rotulo: 'atos finais', singular: 'ato final' },
  { chave: 'despesas', rotulo: 'despesas', singular: 'despesa' },
  { chave: 'historico', rotulo: 'histórico', singular: 'registro' },
  { chave: 'atas', rotulo: 'atas de registro de preços', singular: 'ata' },
  { chave: 'textos', rotulo: 'textos', singular: 'texto' },
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

export function montarCamposProcesso(p) {
  const tipoObjeto = p.tipoObjeto || {}
  const principais = [
    { label: 'Número/Ano', valor: numeroProcesso(p) },
    { label: 'Situação', valor: p.situacaoDesc || p.situacao || '' },
    { label: 'Modalidade', valor: tipoObjeto.tipoDescricao || tipoObjeto.descricao || '' },
    { label: 'Objeto', valor: p.objeto || '' },
    { label: 'Data do processo', valor: formatarData(p.dataProcesso) },
    { label: 'Valor total dos itens (R$)', valor: formatarValor(p.valorTotalItens) },
    { label: 'Quantidade de itens', valor: p.quantidadeItens ?? subrecurso(p, 'itens').length },
  ]
  // Demais campos que a API devolveu (pedido do usuário no Contratos: "todas
  // as informações") — depois dos principais, na ordem em que vierem.
  const demais = Object.entries(p)
    .filter(([chave]) => !CHAVES_PRINCIPAIS.has(chave))
    .map(([chave, valor]) => ({ label: formatarChave(chave), valor: valorProcesso(chave, valor) }))
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
// tem o resto.
export function montarTabelaGenerica(registros) {
  if (!Array.isArray(registros) || !registros.length) return { colunas: [], linhas: [], omitidas: 0 }

  const presentes = []
  for (const raw of registros) {
    for (const chave of Object.keys(raw || {})) {
      if (!ehChaveInterna(chave) && !presentes.includes(chave)) presentes.push(chave)
    }
  }

  const preferidas = COLUNAS_PREFERIDAS.filter((c) => presentes.includes(c))
  const restantes = presentes.filter((c) => !preferidas.includes(c))
  const ordenadas = [...preferidas, ...restantes]
  const escolhidas = ordenadas.slice(0, MAX_COLUNAS_TABELA)

  return {
    colunas: escolhidas.map(formatarChave),
    linhas: registros.map((raw) =>
      escolhidas.map((chave) => {
        const valor = raw ? raw[chave] : undefined
        return ehChaveMonetaria(chave) && valor != null && !Number.isNaN(Number(valor)) ? formatarValor(valor) : valorProcesso(chave, valor)
      }),
    ),
    omitidas: ordenadas.length - escolhidas.length,
  }
}

// Um documento por sub-recurso em `SUBRECURSOS_EM_DOCUMENTO` que tenha
// registros: cada registro vira um bloco com TODOS os campos que a API
// devolveu. Devolve [{ titulo, blocos: [{ titulo, campos }] }].
export function montarDocumentosSubrecursos(p) {
  const base = tituloProcesso(p)
  return SUBRECURSOS_EM_DOCUMENTO.map(({ chave, rotulo, singular }) => ({ chave, registros: subrecurso(p, chave), rotulo, singular }))
    .filter(({ registros }) => registros.length)
    .map(({ registros, rotulo, singular }) => ({
      titulo: `${rotulo} do ${base}`,
      blocos: registros.map((raw, index) => ({
        titulo: `${singular} ${index + 1}`,
        campos: Object.entries(raw || {}).map(([chave, valor]) => ({ label: formatarChave(chave), valor: valorProcesso(chave, valor) })),
      })),
    }))
}

