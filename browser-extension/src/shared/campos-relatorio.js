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
    { label: 'Quantidade de aditivos', valor: Array.isArray(c.aditivos) ? c.aditivos.length : 0 },
  ]
}

// Cada aditivo vira uma SEÇÃO própria, identificada pelo nº de ordem (posição
// no array — sempre confiável) + o sequencial/id do próprio aditivo, quando
// existir. O catálogo de campos desse sub-recurso do Betha ainda não foi
// confirmado ao vivo, então mostramos TODOS os campos que vierem, sem supor
// nomes — nada se perde mesmo sem o schema exato.
export function montarSecoesAditivos(aditivos) {
  if (!Array.isArray(aditivos) || !aditivos.length) return []
  return aditivos.map((raw, index) => {
    const identificador = raw && (raw.sequencial ?? raw.id) != null ? (raw.sequencial ?? raw.id) : null
    const titulo = identificador != null ? `Aditivo ${index + 1} (seq. ${identificador})` : `Aditivo ${index + 1}`
    const campos = raw && typeof raw === 'object'
      ? Object.entries(raw).map(([chave, valor]) => ({ label: formatarChave(chave), valor: valorTexto(valor) }))
      : []
    return { titulo, campos }
  })
}

function formatarChave(chave) {
  return chave.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

function valorTexto(v) {
  if (v == null) return ''
  // Referência a uma contratação (ex.: campo "contratacao" do aditivo) —
  // mostra só "numeroTermo/ano" (ex.: "86/2025") em vez do objeto inteiro,
  // que traz dezenas de campos irrelevantes pro relatório.
  if (typeof v === 'object' && v.numeroTermo != null) {
    return v.ano != null ? `${v.numeroTermo}/${v.ano}` : String(v.numeroTermo)
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function formatarData(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('pt-BR')
}

function formatarValor(v) {
  if (v == null) return ''
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
