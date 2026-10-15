// Utilitários do pacote .zip de relatório (PDFs + anexos), compartilhados por
// report/report.js (contratos) e report/processo.js (processos).

export function nomeAnexo(a) {
  return a.nome || a.nomeArquivo || a.descricao || a.titulo || 'Anexo'
}

// Evita colisão de nome dentro do zip (dois anexos "edital.pdf" — um do
// contrato, outro de um aditivo — sobrescreveriam um ao outro na extração
// sem isto). Mantém o nome original na 1ª ocorrência.
export function nomeUnicoNoZip(nome, usados) {
  if (!usados.has(nome)) {
    usados.add(nome)
    return nome
  }
  const pontoFinal = nome.lastIndexOf('.')
  const base = pontoFinal > 0 ? nome.slice(0, pontoFinal) : nome
  const extensao = pontoFinal > 0 ? nome.slice(pontoFinal) : ''
  let n = 2
  let candidato = `${base} (${n})${extensao}`
  while (usados.has(candidato)) {
    n += 1
    candidato = `${base} (${n})${extensao}`
  }
  usados.add(candidato)
  return candidato
}

export function base64ParaBytes(base64) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Dispara o download local de um Blob.
export function baixarBlob(blob, nomeArquivo) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = nomeArquivo
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
}
