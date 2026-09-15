# syntax=docker/dockerfile:1

# ---- build: instala tudo (com devDependencies) e gera os artefatos ----
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm install

# Copia o monorepo INTEIRO, não só frontend/ e backend/. Copiar só as duas
# pastas deixava de fora o tsconfig.base.json da raiz — que os dois
# tsconfig.json fazem `extends` — e o build morria com "TS5083: Cannot read
# file '/app/tsconfig.base.json'". Detalhe traiçoeiro: `npm run build` local
# passa (o arquivo está lá), então isso só aparecia na hora de publicar.
# Copiando tudo, qualquer arquivo de configuração novo na raiz entra sozinho,
# sem ninguém precisar lembrar de listá-lo aqui.
#
# O .dockerignore já tira node_modules, dist, .git e .env. Vem depois do
# `npm install` de propósito: mudança de código-fonte não invalida a camada de
# dependências. E só este stage recebe tudo — a imagem final (stage "runtime")
# continua copiando apenas dist/, prisma/ e public/.
COPY . .

RUN npm run db:generate -w backend
RUN npm run build -w frontend
RUN npm run build -w backend

# ---- backend-deps: só as dependências de produção do backend ----
# "prisma" (o CLI, não só o @prisma/client) fica em "dependencies" no
# backend/package.json de propósito: o container roda `prisma migrate deploy`
# no start (ver CMD abaixo), então o CLI precisa existir em runtime. O schema
# entra aqui também (não só lá no stage "build") pra esse `npm install` já
# gerar o client de verdade, com o motor certo pra essa imagem.
FROM node:20-slim AS backend-deps
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY backend/package.json ./
COPY backend/prisma ./prisma
RUN npm install --omit=dev

# ---- runtime: imagem final, só com o que roda em produção ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Sem isso o motor do Prisma nem carrega (erro só aparece em runtime, não no
# build — testado e confirmado: quebrava silenciosamente sem esta linha).
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/frontend/dist ./public
COPY backend/package.json ./package.json

EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Aplica migrations já commitadas (nunca gera nenhuma aqui) antes de subir o
# servidor — CLAUDE.md 1.1.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
