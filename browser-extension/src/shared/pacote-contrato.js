// Nomes e anexos do pacote .zip de um contrato — compartilhados por
// report/report.js (contrato avulso) e report/processo.js (contratações
// vinculadas a um processo, dentro do zip do processo).

// Anexos do contrato — `arquivos` é um array inline do próprio registro
// (contrato e cada aditivo podem trazer o seu), nunca um sub-recurso à
// parte; por isso já vêm dentro de `contrato` sem precisar de outra busca.
// Confirmado no projeto irmão Delta Intelligence (CONTEXTO_PROJETO.md §5).
export function coletarAnexosContrato(contrato) {
  const doContrato = (Array.isArray(contrato.arquivos) ? contrato.arquivos : []).map((a) => ({ ...a, origem: 'Contrato' }))
  const doAditivos = (Array.isArray(contrato.aditivos) ? contrato.aditivos : []).flatMap((aditivo, i) =>
    (Array.isArray(aditivo.arquivos) ? aditivo.arquivos : []).map((a) => ({ ...a, origem: `Aditivo ${i + 1}` })),
  )
  // Apostilamentos também podem trazer o seu `arquivos` inline.
  const doApostilamentos = (Array.isArray(contrato.apostilamentos) ? contrato.apostilamentos : []).flatMap((apostilamento, i) =>
    (Array.isArray(apostilamento.arquivos) ? apostilamento.arquivos : []).map((a) => ({ ...a, origem: `Apostilamento ${i + 1}` })),
  )
  // Documentos das janelas "Textos" e "Publicação" do contrato — buscados à
  // parte (não vêm no campo inline `arquivos`, ver service-worker.js).
  const doTextos = (Array.isArray(contrato.anexosTextos) ? contrato.anexosTextos : []).map((a) => ({ ...a, origem: 'Textos' }))
  const daPublicacao = (Array.isArray(contrato.anexosPublicacao) ? contrato.anexosPublicacao : []).map((a) => ({ ...a, origem: 'Publicação' }))
  return [...doContrato, ...doAditivos, ...doApostilamentos, ...doTextos, ...daPublicacao].filter((a) => a && a.id)
}

export function numeroContrato(contrato) {
  return contrato.numeroTermo != null
    ? (contrato.ano ? `${contrato.numeroTermo}-${contrato.ano}` : String(contrato.numeroTermo))
    : `seq-${contrato.sequencial ?? 'contrato'}`
}

export function nomeArquivoZipContrato(contrato) {
  return `anexos-contrato-${numeroContrato(contrato)}.zip`
}

// Pasta dentro do zip que agrupa todos os anexos baixados — pedido do
// usuário para separar melhor os documentos de cada contrato.
export function pastaAnexosContrato(contrato) {
  return `Anexos do contrato numero ${numeroContrato(contrato)}`
}
