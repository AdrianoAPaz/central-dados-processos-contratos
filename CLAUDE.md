# CLAUDE.md — Padrões de Engenharia da Delta

> Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão neste projeto.
> Se você é um colega usando o Claude para construir um sistema: não precisa ler isto, o Claude
> já vai seguir sozinho. Se você é o Douglas revisando antes de publicar: a seção 5 é o checklist.

## 0. Contexto

Este projeto começou a partir do `Modelo` mantido pela Delta. O objetivo dele é simples:
qualquer pessoa — programadora ou não — pode pedir ao Claude para construir o que precisa,
**sem saber nada de arquitetura**, e o resultado ainda assim sai em um formato que dá para
hospedar, dar manutenção e não vira um risco de segurança daqui a seis meses.

As regras da seção 1 não são sugestões. Se o pedido de alguém conflitar com uma delas, o Claude
implementa a regra e explica o motivo em uma frase — não pergunta se pode fazer errado, não faz
os dois. Fora da seção 1, tudo é livre: bibliotecas de UI, organização interna, lógica de
negócio, visual. A ideia não é engessar criatividade, é engessar só os pontos que, quando dados
errados, viram um problema que sobra pro Douglas resolver sozinho meses depois.

## 1. Regras inegociáveis

### 1.1 Persistência de dados — só Postgres

Todo dado que precisa sobreviver ao fechar a aba vai para **PostgreSQL**, acessado só pelo
backend. Nunca:

- `localStorage` / `sessionStorage` / `IndexedDB` como fonte de verdade (ok como cache de UI
  ou rascunho de formulário — não ok como o lugar onde o dado "mora")
- Arquivo SQLite solto dentro da pasta do projeto
- `.json` na raiz (ou em qualquer lugar) fazendo o papel de banco de dados
- Estado que só existe na memória do processo Node — se o container reiniciar, some

Acesso ao banco via **Prisma** (schema em `backend/prisma/schema.prisma`, migrations
versionadas no git — nunca alterar o schema direto no banco de produção). Em dev, sobe um
Postgres local pelo `docker-compose.yml` do próprio projeto; em produção usa o
`postgres_central` compartilhado da VPS (ver `deploy-guide.md`, seção 2).

Quem estiver na rede da Delta ou na VPN pode, como alternativa ao Postgres local em Docker,
usar o Postgres de desenvolvimento compartilhado (`deploy-guide.md` seção 9) — mesma regra de
sempre: a senha real nunca vai pro `.env.example` nem pra nenhum arquivo versionado, só pro
`.env` local de cada um.

Fluxo de migrations, sempre pelo Prisma: mudança de schema local roda
`npx prisma migrate dev --name <descrição>` (gera o arquivo em `backend/prisma/migrations/`,
entra no commit); `prisma db push` só em prototipagem rápida descartável, nunca como forma
definitiva de aplicar schema. Em produção, o container roda `npx prisma migrate deploy`
automaticamente antes de subir o servidor (só aplica migrations já commitadas, não gera
nenhuma) — isso entra no `CMD`/entrypoint do `Dockerfile`.

Parâmetros da própria aplicação — o que pode mudar sem precisar de um novo deploy (regras de
negócio, limites, textos, feature flags, chaves de integração de terceiros) — vão numa tabela de
configuração no Postgres (ex.: `configuracoes`), não em variável de ambiente nova. O `.env` é só
para o que é fixo por ambiente e não muda em runtime: string de conexão, URLs de infraestrutura,
credenciais do próprio Keycloak. Regra prática: se um administrador da aplicação (não o Douglas,
não quem mexe no deploy) deveria poder ajustar esse valor sem depender de ninguém, é parâmetro de
aplicação — vai pro banco, não pro `.env`.

Nome de tabela, coluna e chave estrangeira no banco é sempre **minúsculo** (snake_case: `criado_em`,
não `criadoEm`/`CriadoEm`). O Postgres trata identificador sem aspas como minúsculo por padrão —
um nome com maiúscula só funciona se for citado entre aspas em toda consulta daí em diante, o que
é fácil de esquecer e gera erro chato de diagnosticar. No *schema* do Prisma, o model e os campos
continuam PascalCase/camelCase normalmente (convenção do Prisma/TypeScript, não muda); o que vira
minúsculo é só o nome real no banco, via `@@map`/`@map`:

```prisma
model User {
  id        String   @id
  createdAt DateTime @default(now()) @map("created_at")
  // ...

  @@map("usuario")
}
```

Escolha o nome da tabela **fora da lista de palavras reservadas do SQL** (`user`, `order`,
`group`, `table`, `select`…). O Prisma sempre cita identificadores, então a aplicação
funcionaria com `user` — mas toda consulta manual passaria a exigir `SELECT * FROM "user"`,
e quem esquece recebe um erro de sintaxe que não aponta para a causa. Daí o `usuario` do
exemplo acima.

### 1.2 Estrutura — monorepo, dois pacotes

```
/frontend   React + TypeScript + Vite
/backend    Node.js + TypeScript + Express
```

Nada de HTML único com `<script>`/`<style>` embutidos crescendo até virar um projeto inteiro.
Uma página estática sem nenhum dado para guardar pode fugir da regra — mas isso é raro; no
primeiro campo de formulário que precisa ser salvo, o projeto já nasce como `/frontend` +
`/backend`, não depois.

Em produção, o `backend` serve o build do `frontend` (arquivos estáticos) e expõe a API em
`/api/*` — **um container só, uma porta só**, exatamente o padrão do `deploy-guide.md`. Não
criar dois containers/dois vhosts para um projeto que não justifica essa complexidade.

Em **desenvolvimento**, o caminho preferido também é Docker (`docker-compose.dev.yml` sobe
Postgres + backend + frontend juntos, ninguém precisa instalar Node/npm na máquina) — mas isso
não é bloqueante. Se Docker não rodar na máquina de alguém (acontece, principalmente com quem
está começando agora), `npm install` + `npm run dev` local, com só o Postgres em container,
continua sendo um caminho válido. Ver README.md.

### 1.3 Linguagem — TypeScript, sempre

`.js` puro não entra em código de aplicação (script pontual de infra, tudo bem). Tipos evitam a
categoria de bug mais comum em código gerado rápido: campo que não existe, `undefined` silencioso
que só explode em produção.

### 1.4 Segredos

Nunca no código, nunca no git. `.env` (no `.gitignore`) + `.env.example` versionado, sem valores
reais. Segredo que vazou num commit é considerado comprometido — troca o segredo, não adianta
só apagar o commit.

Um único `.env` na raiz do monorepo — nunca `.env` separado em `/frontend` e `/backend`. O
backend lê a partir da raiz; o frontend (Vite) aponta `envDir` pra raiz no `vite.config.ts` e só
expõe ao navegador as variáveis prefixadas com `VITE_` (as demais — `DATABASE_URL`, segredos do
Keycloak se houver — nunca chegam no bundle do cliente). Atenção: variáveis `VITE_*` são
embutidas no build do frontend, então precisam estar disponíveis no momento do `docker build`,
não só em runtime do container.

O mesmo cuidado vale pra segredo guardado em tabela de configuração (seção 1.1), não só no
`.env`: o endpoint que devolve essa configuração pro frontend nunca retorna o valor real de um
campo-segredo (chave de API de terceiro, token, senha de integração) — devolve em branco, ou um
indicador tipo `"configurado": true` sem o valor. Ao salvar, só sobrescreve o campo se ele vier
preenchido; campo em branco significa "não mexer no que já está guardado". É a única forma de
editar um segredo por uma tela sem ele aparecer em resposta de API, aba de rede do navegador ou
log de frontend.

Mecânica exata (exemplo ilustrativo — adapte nomes e model, não é uma rota real do template):

```ts
// Leitura: tira o segredo da resposta, manda só se está configurado ou não.
app.get('/api/configuracoes', async (_req, res) => {
  const { chaveApiTerceiro, ...publico } = await prisma.configuracao.findFirstOrThrow();
  res.json({ ...publico, chaveApiTerceiroConfigurada: Boolean(chaveApiTerceiro) });
});

// Escrita: campo em branco no body não sobrescreve o que já está guardado.
app.put('/api/configuracoes', async (req, res) => {
  const { chaveApiTerceiro, ...resto } = req.body;
  await prisma.configuracao.update({
    where: { id: 1 },
    data: {
      ...resto,
      ...(chaveApiTerceiro ? { chaveApiTerceiro } : {}),
    },
  });
  res.status(204).send();
});
```

### 1.5 Autenticação

Se o sistema precisa de login, é **Keycloak** (realm `Apps`, IdP `azure-ad` / Office 365) — ver
`KEYCLOAK.md`. Não implementar login/senha próprio, não introduzir outro provedor sem alinhar
com o Douglas antes.

O Keycloak resolve só **autenticação** (quem é a pessoa). **Autorização** — o que essa pessoa
pode fazer dentro do sistema, qual papel ela tem — é responsabilidade de cada aplicação, guardada
no Postgres da própria app (ex.: tabela `usuarios`/`papeis` chaveada pelo `sub` do JWT). Nunca
modelar permissão de negócio como role de realm do Keycloak.

Em **desenvolvimento**, use o client já existente `dltdevelop`
(`KEYCLOAK_CLIENT_ID=dltdevelop`) pra testar login localmente sem precisar criar um client novo
antes de começar a codar. Ele só aceita as portas cadastradas explicitamente nas suas Valid
redirect URIs (o wildcard `http://localhost:*/*` que aparece lá não funciona pra qualquer porta
na prática — testado) — por isso o template roda o frontend sempre na porta `5183`, que já está
na lista. Um client dedicado (nome do app, redirect URIs de produção) só entra na hora de
publicar, seguindo `deploy-guide.md` seção 3.

### 1.6 Qualidade mínima

ESLint + Prettier configurados desde o primeiro commit (o template já vem com isso pronto). Sem
"arruma depois" — código de IA sem lint é exatamente o tipo de "javascript horrendo" que este
documento existe para evitar.

### 1.7 Deploy

Segue o `deploy-guide.md` à risca: Docker, `network_public`, `postgres_central`, nginx/certbot,
GitHub Actions. Não inventar outro provedor de hospedagem, outro banco gerenciado ou outra
esteira de CI sem alinhar com o Douglas — cada exceção é mais um sistema que ele sozinho precisa
entender para sempre.

### 1.8 Documentação — README.md obrigatório

Todo projeto tem um `README.md` na raiz, desde o primeiro commit: nome do projeto, o que ele faz
(2-3 frases), como rodar em desenvolvimento (`npm install`, `.env`, comandos) e quais variáveis
de ambiente ele espera. Não é burocracia — é o que permite que alguém além de quem "pediu" o
projeto (o Douglas, um colega que herdar a manutenção) entenda o que está rodando ali sem
precisar reconstruir o contexto que só existiu numa conversa com a IA.

### 1.9 Git — branch por funcionalidade, sempre via Pull Request

Nunca commitar nem dar push direto na `main`. Toda mudança nasce numa branch nova (ex.:
`feature/nome-da-coisa`, `fix/o-que-corrigiu`) e vira um **Pull Request** — mesmo em projetos de
uma pessoa só. Isso vale pro Claude: ao terminar uma funcionalidade, cria a branch, commita lá, e
abre o PR. Nunca fazer merge sozinho — quem aprova e mergeia é o Douglas ou o dono do projeto.

## 2. Como o Claude deve se comportar

- **Se pedirem para "salvar os dados" sem especificar como**: implementar com Postgres + Prisma
  direto, sem perguntar — é a única opção válida aqui.
- **Se pedirem para guardar um parâmetro ou configuração da aplicação**: usar uma tabela de
  configuração no Postgres, não uma variável nova no `.env` — `.env` é só pra infraestrutura fixa
  do ambiente (seção 1.1). Se o parâmetro for um segredo, aplicar o padrão de "nunca devolve o
  valor real" da seção 1.4.
- **Se o projeto ainda não tem nome definido**: perguntar antes de gerar `package.json`,
  `docker-compose.yml` ou qualquer arquivo que grave esse nome — ele vira o nome do container,
  do domínio, do banco e do client no Keycloak (seção 4). Renomear depois é caçar o nome errado
  espalhado em vários arquivos.
- **Se pedirem algo que viola a seção 1** (ex.: "salva isso num arquivo JSON mesmo, é mais
  simples"): explicar em 1-2 frases por que isso não escala ou não é seguro, e implementar do
  jeito certo de qualquer forma. Quem pede geralmente não sabe que está pedindo algo problemático
  — só quer que funcione. Fazer certo _é_ fazer funcionar, aqui.
- **Se o pedido exigir sair do padrão** (outra linguagem, outro banco, outro host, uma dependência
  pesada e incomum): parar e perguntar, explicando o motivo da regra. Abrir uma exceção às vezes
  vale a pena; abrir em silêncio nunca vale, porque quem sofre depois é quem for dar manutenção
  sem esse contexto.
- **Se a pessoa não entende um termo técnico** (pode não saber o que é "API" ou "variável de
  ambiente"): explicar em 1 frase simples, sem transformar isso em desculpa para simplificar a
  implementação. Inexperiência de quem pede não é motivo para arquitetura pior — é o contrário:
  o Claude é a única revisão de arquitetura que este projeto vai ter.
- **Antes de considerar algo "pronto para publicar"**: rodar o checklist do `deploy-guide.md`,
  seção 8.

## 3. Nunca mais (histórico real — não repetir)

Cada item abaixo já aconteceu em projeto real da Delta:

- Projeto inteiro em um `.html` de milhares de linhas, com JS e CSS embutidos.
- Dados de produção guardados só no IndexedDB do navegador — somem se o usuário limpar o cache.
- Banco SQLite dentro da pasta do projeto, sem backup, sem controle de acesso.
- `.json` na raiz fazendo o papel de banco de dados.
- Ninguém — nem quem "construiu" o projeto — sabia em que linguagem ele foi feito ou onde os
  dados ficavam guardados.

## 4. Ao começar um projeto novo

1. Ter os arquivos do `Modelo`, de um destes dois jeitos:
   - o Douglas cria um repositório a partir do template no GitHub (botão **"Use this
     template"**); ou
   - sem precisar esperar ninguém: `git clone` direto do `Modelo`
     (`git clone https://github.com/deltagestaopublica/modelo.git nome-do-projeto`) e começar
     um histórico de git novo e independente (`rm -rf .git && git init`). Pra isso só precisa
     de acesso de leitura ao repositório `Modelo` — peça ao Douglas uma vez só; depois serve
     pra qualquer projeto futuro, sem pedir de novo.

   Não copiar a pasta manualmente fora do git, não começar do zero.
2. Nomear o app (kebab-case) **antes de qualquer outra coisa** — esse nome vira o nome do
   container, do domínio (`<nome>.deltainf.com.br`), do banco dentro do `postgres_central` e,
   se houver login, do client no Keycloak. Trocar depois é caçar o nome errado em vários
   arquivos.
3. Rodar `npm install` na raiz (workspaces cobre `frontend` e `backend`).
4. Descrever o que a pessoa quer construir; o Claude adapta dentro da estrutura já criada.
5. Quando o projeto já tiver conteúdo próprio e for a hora de subir pro GitHub de verdade
   (colaborar com alguém, ou publicar): o Douglas cria um repositório **vazio** — não a partir
   do template, já que os arquivos já existem — e você só faz `git remote add origin <url>` e
   `git push -u origin main`.

## 5. Checklist do Douglas antes de publicar

- [ ] `/frontend` e `/backend` existem — não é um HTML solto.
- [ ] Dado persistente está em Postgres (nenhum `.sqlite` / `.json` / IndexedDB como fonte de
      verdade).
- [ ] Migrations do Prisma commitadas em `backend/prisma/migrations/` (não só `db push`).
- [ ] Parâmetros de negócio/configuração estão numa tabela do Postgres, não espalhados no `.env`.
- [ ] Campos de segredo em telas de configuração nunca devolvem o valor real pro frontend.
- [ ] Um único `.env` na raiz; nenhum `.env` duplicado em `/frontend` ou `/backend`.
- [ ] `.env.example` existe e bate com o `.env` real; nenhum segredo no histórico do git.
- [ ] `README.md` existe na raiz e reflete o projeto atual.
- [ ] Nome do app é consistente em container, domínio, banco e (se houver) client do Keycloak.
- [ ] Se tem login: é Keycloak, autorização vive na aplicação/Postgres (não em roles de realm),
      e o client de produção (não o `dltdevelop`) foi criado — ver `deploy-guide.md` seção 3.
- [ ] Passa no checklist "pronto para produção" do `deploy-guide.md` (seção 8).

## Referências

@deploy-guide.md
@KEYCLOAK.md
