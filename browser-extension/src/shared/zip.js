// Escritor de ZIP mínimo, sem compressão (método "store") — suficiente pra
// agrupar anexos (já comprimidos na maioria dos formatos: PDF/imagem) num
// único arquivo pra download. Sem dependência externa: a extensão não tem
// build/bundler (manifest aponta direto pros .js em src/), então uma
// biblioteca de terceiros exigiria vendorizar o arquivo — implementar o
// formato (bem pequeno no modo "store") evita isso e mantém o código auditável.
// Referência do formato: PKWARE .ZIP File Format Specification.

const TABELA_CRC32 = (() => {
  const tabela = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    tabela[n] = c
  }
  return tabela
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = TABELA_CRC32[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// Data/hora no formato DOS (usado pelos campos de data do ZIP) — só precisa
// ser um valor plausível, nenhum leitor de ZIP depende disso pra extrair.
function dataHoraDos(data) {
  const dosTime = ((data.getHours() & 0x1f) << 11) | ((data.getMinutes() & 0x3f) << 5) | ((data.getSeconds() >> 1) & 0x1f)
  const dosDate = (((data.getFullYear() - 1980) & 0x7f) << 9) | (((data.getMonth() + 1) & 0xf) << 5) | (data.getDate() & 0x1f)
  return { dosTime, dosDate }
}

function escreverUint16LE(view, offset, valor) {
  view.setUint16(offset, valor, true)
}
function escreverUint32LE(view, offset, valor) {
  view.setUint32(offset, valor, true)
}

// `arquivos`: [{ nome: string, bytes: Uint8Array }, ...]. Nomes duplicados
// são desambiguados pelo chamador (ver nomeUnico em report.js) — este módulo
// não resolve colisão, só grava o que recebeu.
export function criarZip(arquivos) {
  const codificadorTexto = new TextEncoder()
  const agora = dataHoraDos(new Date())

  const partesArquivo = []
  const partesCentral = []
  let offset = 0

  for (const { nome, bytes } of arquivos) {
    const nomeBytes = codificadorTexto.encode(nome)
    const crc = crc32(bytes)
    const tamanho = bytes.length

    const headerLocal = new DataView(new ArrayBuffer(30))
    escreverUint32LE(headerLocal, 0, 0x04034b50) // assinatura local file header
    escreverUint16LE(headerLocal, 4, 20) // versão necessária
    escreverUint16LE(headerLocal, 6, 0x0800) // bit 11 = nomes em UTF-8
    escreverUint16LE(headerLocal, 8, 0) // método: sem compressão (store)
    escreverUint16LE(headerLocal, 10, agora.dosTime)
    escreverUint16LE(headerLocal, 12, agora.dosDate)
    escreverUint32LE(headerLocal, 14, crc)
    escreverUint32LE(headerLocal, 18, tamanho) // tamanho comprimido = original (store)
    escreverUint32LE(headerLocal, 22, tamanho)
    escreverUint16LE(headerLocal, 26, nomeBytes.length)
    escreverUint16LE(headerLocal, 28, 0) // sem campo extra

    partesArquivo.push(new Uint8Array(headerLocal.buffer), nomeBytes, bytes)

    const headerCentral = new DataView(new ArrayBuffer(46))
    escreverUint32LE(headerCentral, 0, 0x02014b50) // assinatura central directory
    escreverUint16LE(headerCentral, 4, 20) // versão que gravou
    escreverUint16LE(headerCentral, 6, 20) // versão necessária
    escreverUint16LE(headerCentral, 8, 0x0800)
    escreverUint16LE(headerCentral, 10, 0)
    escreverUint16LE(headerCentral, 12, agora.dosTime)
    escreverUint16LE(headerCentral, 14, agora.dosDate)
    escreverUint32LE(headerCentral, 16, crc)
    escreverUint32LE(headerCentral, 20, tamanho)
    escreverUint32LE(headerCentral, 24, tamanho)
    escreverUint16LE(headerCentral, 28, nomeBytes.length)
    escreverUint16LE(headerCentral, 30, 0) // extra field length
    escreverUint16LE(headerCentral, 32, 0) // comment length
    escreverUint16LE(headerCentral, 34, 0) // disco inicial
    escreverUint16LE(headerCentral, 36, 0) // atributos internos
    escreverUint32LE(headerCentral, 38, 0) // atributos externos
    escreverUint32LE(headerCentral, 42, offset) // offset do header local deste arquivo

    partesCentral.push(new Uint8Array(headerCentral.buffer), nomeBytes)

    offset += headerLocal.buffer.byteLength + nomeBytes.length + tamanho
  }

  const offsetCentral = offset
  let tamanhoCentral = 0
  for (const parte of partesCentral) tamanhoCentral += parte.length

  const fimCentral = new DataView(new ArrayBuffer(22))
  escreverUint32LE(fimCentral, 0, 0x06054b50) // assinatura end of central directory
  escreverUint16LE(fimCentral, 4, 0) // disco atual
  escreverUint16LE(fimCentral, 6, 0) // disco com início do central directory
  escreverUint16LE(fimCentral, 8, arquivos.length) // entradas neste disco
  escreverUint16LE(fimCentral, 10, arquivos.length) // entradas totais
  escreverUint32LE(fimCentral, 12, tamanhoCentral)
  escreverUint32LE(fimCentral, 16, offsetCentral)
  escreverUint16LE(fimCentral, 20, 0) // comentário

  return new Blob([...partesArquivo, ...partesCentral, new Uint8Array(fimCentral.buffer)], {
    type: 'application/zip',
  })
}
