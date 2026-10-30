// Padroniza títulos dos relatórios (tela e PDF) com iniciais maiúsculas, no
// estilo de documento administrativo: "solicitação de fornecimento 1" ->
// "Solicitação de Fornecimento 1". Preposições e artigos ficam em minúsculas
// (exceto no início do título ou após "—"); o resto de cada palavra é
// preservado, então siglas ("LTDA", "SF") e números não mudam.
const CONECTIVOS = new Set(['a', 'o', 'as', 'os', 'e', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'à', 'às', 'para', 'por', 'com', 'ou'])

export function formatarTitulo(texto) {
  if (typeof texto !== 'string') return texto
  let inicio = true
  return texto
    .split(/(\s+)/)
    .map((parte) => {
      if (!parte.trim()) return parte
      if (parte === '—' || parte === '-' || parte === '–') {
        inicio = true
        return parte
      }
      const nu = parte.replace(/^[^\p{L}\p{N}]+/u, '')
      const ehConectivo = CONECTIVOS.has(nu.toLowerCase())
      const maiuscula = inicio || !ehConectivo
      inicio = false
      if (!maiuscula) return parte
      return parte.replace(/\p{L}/u, (letra) => letra.toLocaleUpperCase('pt-BR'))
    })
    .join('')
}
