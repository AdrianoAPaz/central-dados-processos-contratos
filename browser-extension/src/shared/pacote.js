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

// Gera o PDF de cada documento e baixa cada anexo (um de cada vez — rajada de
// requisições autenticadas arrisca rate-limit oculto no Betha), devolvendo os
// arquivos já com o caminho dentro do zip: PDFs em `prefixo`, anexos em
// `prefixo + pasta/`. Cada um gera/falha independente dos demais e vira uma
// linha em `lista` (<ul>); `rotulo` identifica de quem é a linha quando o zip
// junta vários documentos (processo + contratações).
//   documentos: [{ nome, gerar() }]   anexos: [{ id, origem, ...metadados }]
//   sistema: 'compras' pros anexos do Compras (omitido = Betha Contratos).
export async function coletarArquivosPacote({ documentos, anexos, prefixo = '', pasta, sistema, lista, rotulo = '' }) {
  const usados = new Set()
  const arquivos = []

  for (const documento of documentos) {
    const li = document.createElement('li')
    li.textContent = `⏳ ${rotulo}${documento.nome}`
    lista.appendChild(li)
    try {
      const pdfBlob = documento.gerar()
      arquivos.push({ nome: `${prefixo}${nomeUnicoNoZip(documento.nome, usados)}`, bytes: new Uint8Array(await pdfBlob.arrayBuffer()) })
      li.textContent = `✅ ${rotulo}${documento.nome}`
    } catch (e) {
      li.textContent = `⚠️ ${rotulo}${documento.nome} — erro: ${String((e && e.message) || e)}`
    }
  }

  for (const anexo of anexos) {
    const li = document.createElement('li')
    li.textContent = `⏳ ${rotulo}${anexo.origem} — ${nomeAnexo(anexo)}`
    lista.appendChild(li)

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'baixar-anexo', arquivoId: anexo.id, sistema })
      if (!resp || resp.erro || resp.success !== true || typeof resp.base64 !== 'string') {
        li.textContent = `⚠️ ${rotulo}${anexo.origem} — ${nomeAnexo(anexo)} (falha: ${(resp && resp.erro) || 'sem retorno'})`
        continue
      }
      arquivos.push({ nome: `${prefixo}${pasta}/${nomeUnicoNoZip(nomeAnexo(anexo), usados)}`, bytes: base64ParaBytes(resp.base64) })
      li.textContent = `✅ ${rotulo}${anexo.origem} — ${nomeAnexo(anexo)}`
    } catch (e) {
      li.textContent = `⚠️ ${rotulo}${anexo.origem} — ${nomeAnexo(anexo)} (erro: ${String((e && e.message) || e)})`
    }
  }

  return arquivos
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
