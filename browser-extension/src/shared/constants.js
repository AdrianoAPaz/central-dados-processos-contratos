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
// Host, caminho base, recurso e sub-recursos confirmados ao vivo no projeto
// irmão Delta Intelligence (betha/selectors.md, 2026-07-01 a 2026-07-17):
// GET api.compras.betha.cloud/compras/api/processosadministrativo e
// processosadministrativo/{id}/<subrecurso>, mesmo envelope paginado do
// Contratos ({ offset, limit, hasNext, content, total }). A extensão ainda
// usa a ORIGEM observada nas requisições da própria página (ver
// page/interceptor.js) e só cai neste host/caminho como fallback.
export const BETHA_COMPRAS = {
  siteHost: 'compras.betha.cloud',
  apiHost: 'api.compras.betha.cloud',
  basePath: '/compras/api',
}

export const ENDPOINT_PROCESSOS = 'processosadministrativo'

// chave (`tipo` enviado à Central) -> caminho relativo a
// `<ENDPOINT_PROCESSOS>/{id}/`. Os oito primeiros respondem 200 (probe do
// Delta Intelligence); `textos` (só consulta sob demanda lá) e
// `atasregistropreco` (atas ligadas ao processo, confirmado 2026-07-06) também.
export const SUBRECURSOS_PROCESSO = {
  itens: 'itens',
  despesas: 'despesas',
  lotes: 'lotes',
  sessoesjulgamento: 'sessoesjulgamento',
  historico: 'historico',
  pareceres: 'pareceres',
  atosfinais: 'atosfinais',
  participantes: 'participantes',
  textos: 'textos',
  atas: 'atasregistropreco',
  // Telas do menu "Ações" do processo no Compras (caminhos vistos nas
  // chamadas da própria tela, 2026-10-30). Só entram no relatório quando
  // têm registros.
  entidadesparticipantes: 'entidadesparticipantes',
  publicacoes: 'publicacoes',
  impugnacoes: 'impugnacoes',
  documentosexigidos: 'documentos',
}

export const STORAGE_KEYS = {
  HEADERS: 'centralDados.headers',
  HEADERS_COMPRAS: 'centralDados.headersCompras',
  BACKEND_URL: 'centralDados.backendUrl',
}
