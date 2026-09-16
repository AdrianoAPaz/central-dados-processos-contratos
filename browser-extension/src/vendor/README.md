# Bibliotecas de terceiros vendorizadas

A extensão não tem build/bundler (o `manifest.json` aponta direto pros `.js` em
`src/`), então uma dependência de terceiro só funciona vendorizada aqui como
arquivo local — nunca via CDN (a CSP do `manifest.json` só permite `'self'`).

| Arquivo | Pacote | Versão | Licença | Uso |
| --- | --- | --- | --- | --- |
| `jspdf.umd.min.js` | [`jspdf`](https://github.com/parallax/jsPDF) | 4.2.1 | MIT | Gera o PDF do relatório em `src/shared/pdf-relatorio.js`. |
| `jspdf.plugin.autotable.min.js` | [`jspdf-autotable`](https://github.com/simonbengtsson/jsPDF-AutoTable) | 5.0.8 | MIT | Desenha as tabelas do PDF (itens, aditivos, solicitações de fornecimento). |

Build usado: `dist/*.umd.min.js` de cada pacote (auto-contido — sem import de
módulo externo por bare specifier, diferente do build `.es.min.js`/`.mjs`, que
depende de um bundler pra resolver `fflate`/`fast-png`/etc. e por isso não
funciona carregado direto por `<script type="module">` numa extensão sem
build). Carregados como `<script>` clássico (não-module) em `report.html`,
**nessa ordem** — `jspdf.umd.min.js` primeiro, que define `window.jspdf.jsPDF`;
`jspdf.plugin.autotable.min.js` depois, que se auto-registra nele
(`jsPDF.API.autoTable = ...`) assim que carrega.

Para atualizar: baixar o tarball do pacote (`npm pack <pacote>`), extrair e
copiar o `dist/*.umd.min.js` correspondente pra aqui, mantendo o cabeçalho de
licença do arquivo.
