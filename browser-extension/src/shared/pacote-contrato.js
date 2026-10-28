// Nomes e anexos do pacote .zip de um contrato — compartilhados por
// report/report.js (contrato avulso) e report/processo.js (contratações
// vinculadas a um processo, dentro do zip do processo).

// Anexos do contrato — `arquivos` é um array inline do próprio registro
// (contrato e cada aditivo podem trazer o seu), nunca um sub-recurso à
// parte; por isso já vêm dentro de `contrato` sem precisar de outra busca.
// Confirmado no projeto irmão Delta Intelligence (CONTEXTO_PROJETO.md §5).
//
// Os anexos das alterações contratuais (aditivos, apostilamentos e rescisões)
// vão numa pasta própria, separada da dos anexos do contrato (pedido do
// usuário, 2026-10-27) — por isso carregam `pastaZip`, que sobrepõe a pasta
// padrão em coletarArquivosPacote. Sem nenhum anexo nas alterações, a pasta
// nem é criada.
export function coletarAnexosContrato(contrato) {
  const doContrato = (Array.isArray(contrato.arquivos) ? contrato.arquivos : []).map((a) => ({ ...a, origem: 'Contrato' }))
  const pastaAlteracoes = pastaAnexosAlteracoes(contrato)
  const deAlteracao = (registros, rotulo) =>
    (Array.isArray(registros) ? registros : []).flatMap((registro, i) =>
      (Array.isArray(registro.arquivos) ? registro.arquivos : []).map((a) => ({
        ...a,
        origem: `${rotulo} ${i + 1}`,
        pastaZip: pastaAlteracoes,
      })),
    )
  const doAditivos = deAlteracao(contrato.aditivos, 'Aditivo')
  const doApostilamentos = deAlteracao(contrato.apostilamentos, 'Apostilamento')
  const dasRescisoes = deAlteracao(contrato.rescisoes, 'Rescisão')
  // Documentos das janelas "Textos" e "Publicação" do contrato — buscados à
  // parte (não vêm no campo inline `arquivos`, ver service-worker.js).
  const doTextos = (Array.isArray(contrato.anexosTextos) ? contrato.anexosTextos : []).map((a) => ({ ...a, origem: 'Textos' }))
  const daPublicacao = (Array.isArray(contrato.anexosPublicacao) ? contrato.anexosPublicacao : []).map((a) => ({ ...a, origem: 'Publicação' }))
  return [...doContrato, ...doAditivos, ...doApostilamentos, ...dasRescisoes, ...doTextos, ...daPublicacao].filter(
    (a) => a && a.id,
  )
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

// Pasta dos anexos das alterações contratuais (aditivos, apostilamentos e
// rescisões) do contrato.
export function pastaAnexosAlteracoes(contrato) {
  return `Anexos das alteracoes contratuais do contrato numero ${numeroContrato(contrato)}`
}
