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

// Betha Compras Cloud (compras.betha.cloud) — processos administrativos.
// ATENÇÃO: nenhum destes valores foi confirmado ao vivo (diferente do Betha
// Contratos acima) — são palpites pelo mesmo padrão do Contratos
// (api.<sistema>.betha.cloud/<sistema>/api). A extensão captura a sessão e a
// ORIGEM real da API a partir das requisições da própria página do Compras
// (ver page/interceptor.js), então `apiHost`/`basePath` abaixo só valem como
// fallback; os caminhos de `ENDPOINT_PROCESSOS` e `SUBRECURSOS_PROCESSO` e a
// sintaxe do filtro (service-worker.js, buscarProcessos) precisam ser
// conferidos na aba Rede do navegador (DevTools) numa tela de processo
// administrativo e corrigidos aqui se divergirem. 404/400 em um sub-recurso
// aparece como aviso no popup, não como erro silencioso.
export const BETHA_COMPRAS = {
  siteHost: 'compras.betha.cloud',
  apiHost: 'api.compras.betha.cloud',
  basePath: '/compras/api',
}

export const ENDPOINT_PROCESSOS = 'processosadministrativos'

// chave no registro enviado à Central -> caminho relativo a
// `<ENDPOINT_PROCESSOS>/{id}/`.
export const SUBRECURSOS_PROCESSO = {
  lotes: 'lotes',
  itens: 'itens',
  fornecedores: 'participantes',
  documentos: 'documentos',
}

export const STORAGE_KEYS = {
  HEADERS: 'centralDados.headers',
  HEADERS_COMPRAS: 'centralDados.headersCompras',
  BACKEND_URL: 'centralDados.backendUrl',
}
