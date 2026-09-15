// Único sistema-alvo desta extensão: Betha Contratos (contratos.betha.cloud).
// Ver Delta-Intelligence (CONTEXTO_PROJETO.md §5) para a origem destes valores
// - confirmados ao vivo contra a API real do Betha.
export const BETHA_CONTRATOS = {
  siteHost: 'contratos.betha.cloud',
  apiHost: 'api.contratos.betha.cloud',
  basePath: '/contratos/api',
}

export const ENDPOINT_CONTRATACOES = 'contratacoes'

// `ambienteContratacao=TODAS` traz qualquer tipo de instrumento (Contrato,
// Ata, Compra Direta, Credenciamento, etc.).
export const AMBIENTE_CONTRATACAO_TODAS = 'TODAS'

export const STORAGE_KEYS = {
  HEADERS: 'centralDados.headers',
  BACKEND_URL: 'centralDados.backendUrl',
}
