# Central de Dados de Processos e Contratos

Armazena dados de processos administrativos, contratos, solicitações de fornecimento (ordens de
compra) e interações contábeis vindos dos sistemas Betha Cloud. Uso interno da equipe de suporte,
sem necessidade de login.

---

Stack: **Node.js + TypeScript + Express** (backend) e **React + TypeScript + Vite** (frontend),
num monorepo com npm workspaces. Banco: **PostgreSQL** via **Prisma**. Deploy: Docker na VPS da
Delta. As regras completas estão em `CLAUDE.md`.

## Rodando em desenvolvimento

### Caminho preferido: tudo em Docker

Não precisa instalar Node nem npm na máquina — só Docker.

1. `cp .env.example .env` — o padrão já funciona sem editar nada.
2. `docker compose -f docker-compose.dev.yml up -d --build`.
3. Na primeira vez (e sempre que houver migration nova), aplique de dentro do container:
   `docker compose -f docker-compose.dev.yml exec app npm run db:migrate -w backend`.
4. Abra `http://localhost:5183`.

### Alternativa sem Docker

Pra quem não consegue instalar Docker (acontece, principalmente com quem está começando) — só
o Postgres precisa de container, o resto roda direto com Node/npm:

1. `npm install` (instala frontend e backend de uma vez).
2. `cp .env.example .env`.
3. Suba só o Postgres: `docker compose -f docker-compose.dev.yml up -d postgres`.
4. Aplique as migrations: `npm run db:migrate`.
5. `npm run dev` — sobe backend (`:8090`) e frontend (`:5183`) juntos.
6. Abra `http://localhost:5183`.

> Rodando mais de um projeto deste template ao mesmo tempo na sua máquina? As portas (`5433`,
> `8090`, `5183`) só servem uma instância por vez — pare a de um (`docker compose -f
> docker-compose.dev.yml down`) antes de subir a do outro, ou troque as portas em
> `docker-compose.dev.yml` e no `.env`.

> Está na rede da Delta ou na VPN? Dá pra pular o Postgres em container e usar o Postgres de
> desenvolvimento compartilhado direto — troque o `DATABASE_URL` no seu `.env` (peça a senha
> pro Douglas, nunca cole ela em nenhum arquivo do projeto). Ver `deploy-guide.md` seção 9.

## Estrutura

```
/frontend   React + TypeScript + Vite
/backend    Node.js + TypeScript + Express + Prisma
```

Em produção, o `backend` serve o build do `frontend` e expõe a API em `/api/*` — um processo só,
uma porta só. Ver `deploy-guide.md` pra publicar.

Sem login (CLAUDE.md 1.5) — o schema do Prisma começa vazio; a feature de exemplo `tasks` do
template original (que dependia de usuário autenticado) foi removida.

## Comandos úteis

| Comando              | O que faz                                                    |
| --------------------- | ------------------------------------------------------------ |
| `npm run dev`        | backend + frontend em modo desenvolvimento                   |
| `npm run build`      | build de produção dos dois                                   |
| `npm run lint`       | ESLint no projeto inteiro                                    |
| `npm run format`     | Prettier no projeto inteiro                                  |
| `npm run db:migrate` | cria/aplica uma migration nova (dev)                         |
| `npm run db:studio`  | abre o Prisma Studio (ver os dados numa interface de tabela) |

Rodando via Docker, prefixe com `docker compose -f docker-compose.dev.yml exec app` (ex.:
`docker compose -f docker-compose.dev.yml exec app npm run lint`).

## Variáveis de ambiente

Ver `.env.example` — é a lista completa, com comentário explicando cada uma.
