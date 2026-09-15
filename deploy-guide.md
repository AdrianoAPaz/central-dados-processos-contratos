# Deploy Guide — publicar um app na VPS Delta

> Playbook reutilizável para colocar **qualquer app** no ar na VPS da Delta, na mesma
> estrutura já existente (Docker + `network_public` + Postgres + nginx/certbot + Keycloak +
> deploy automático). Destilado do deploy do **DIC** — copie este arquivo para o novo projeto.

**Como usar com o Claude (agente de deploy):** cole o bloco **"Prompt do agente de deploy"**
(no fim) no Claude aberto **dentro do projeto que você quer publicar**. Ele roda as checagens,
faz as poucas perguntas necessárias e gera o plano + os arquivos (Dockerfile, compose, vhost,
workflow) seguindo este padrão.

---

## 0. A infra da VPS Delta (fatos conhecidos)

| Componente          | Fato                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Host**            | VPS Linux (Docker instalado). Usuário de deploy: `deploy`. Repos em `~/<app>`.                                                                                      |
| **Rede Docker**     | `network_public` (external) — **todos os apps entram nela**; os containers se enxergam pelo **nome**.                                                               |
| **Postgres**        | Container `postgres_central` (postgres:16) na `network_public`. Acessível como `postgres_central:5432`. Superusuário `postgres` (via `docker exec`).                |
| **Postgres de dev** | Servidor compartilhado em `192.168.2.228:5432` (só alcançável na rede da Delta ou VPN), usuário `postgres` — peça a senha pro Douglas fora do repositório, nunca a documente aqui. Alternativa ao Postgres local em Docker. Ver seção 9.                              |
| **Proxy**           | Container `nginx_proxy` em `~/apps/proxy`, com **`nginx.conf` monolítico** (um arquivo, blocos `server` dentro de `http{}`; **não** usa `conf.d`/`sites-enabled`).  |
| **TLS**             | **certbot por webroot** (container `certbot_ssl`): volumes `./certbot/conf → /etc/letsencrypt` e `./certbot/www → /var/www/certbot`. **Não** use `certbot --nginx`. |
| **Auth (opcional)** | Keycloak em `https://auth.deltainf.com.br`, realm `Apps`, IdP `azure-ad` (Office 365). Ver `KEYCLOAK.md`.                                                           |
| **Deploy**          | GitHub Actions faz SSH na VPS a cada push em `main`. Secrets do repo: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.                                                        |
| **Padrão de app**   | container próprio na `network_public`, **sem publicar porta no host** (o nginx alcança pelo nome do container); nginx faz proxy + TLS.                              |

> **Princípio-chave:** o nginx alcança o app por `http://<container_name>:<porta_interna>` na
> `network_public`. Logo, **o app não precisa publicar porta no host** — isso elimina colisão
> de portas entre projetos (foi o que complicou no DIC, que acabou em 8081).

---

## 1. Checagens de prontidão (rode na VPS antes)

Defina as variáveis e rode os blocos. Tudo deve passar.

```bash
APP=deltapp                      # nome do app/container (kebab-case)
DOMAIN=deltapp.deltainf.com.br   # domínio público
PORT=8080                        # porta INTERNA do container (não precisa ser única no host)

# 1) DNS aponta para a VPS?
dig +short "$DOMAIN"             # deve retornar o IP público da VPS

# 2) A rede e os serviços de base estão de pé?
docker network inspect network_public >/dev/null 2>&1 && echo "✅ network_public" || echo "❌ rede ausente"
docker ps --format '{{.Names}}: {{.Status}}' | grep -E 'postgres_central|nginx_proxy|certbot_ssl'

# 3) ip_forward = 1? (senão a rede Docker não roteia — ver gotchas)
sysctl -n net.ipv4.ip_forward   # tem que ser 1

# 4) O nome do app já está em uso? (evitar colisão de container/vhost)
docker ps -a --format '{{.Names}}' | grep -x "$APP" && echo "⚠️ container já existe" || echo "✅ nome livre"
grep -q "$DOMAIN" ~/apps/proxy/nginx.conf && echo "⚠️ domínio já no nginx" || echo "✅ domínio livre"
```

Se o app depende de serviços externos (BI, APIs), teste a conectividade a partir de um
container **na mesma rede** (é assim que ele vai rodar):

```bash
docker run --rm --network network_public alpine sh -c 'apk add --no-cache curl >/dev/null; curl -sS -m 8 -o /dev/null -w "%{http_code}\n" https://SEU-SERVICO-EXTERNO/health || echo falhou'
# para porta TCP crua (ex.: banco externo): nc -zv host porta  (instale netcat na imagem)
```

---

## 2. Postgres — criar banco/usuário do app

```bash
docker exec -i postgres_central psql -U postgres <<SQL
CREATE ROLE ${APP} WITH LOGIN PASSWORD 'TROQUE_POR_SENHA_FORTE';
CREATE DATABASE ${APP} OWNER ${APP};
SQL
docker exec -i postgres_central psql -U postgres -d ${APP} <<SQL
ALTER SCHEMA public OWNER TO ${APP};
GRANT ALL ON SCHEMA public TO ${APP};
SQL
```

A app conecta por `postgres://${APP}:SENHA@postgres_central:5432/${APP}` (entrando na `network_public`).

---

## 3. Keycloak — client (só se o app tiver login)

No `https://auth.deltainf.com.br`, realm `Apps` → **Clients → Create client**:

- Client type `OpenID Connect`, Client ID = `${APP}`, **Client authentication: Off** (público, PKCE), **Standard flow** on.
- **Valid redirect URIs**: `https://${DOMAIN}/*` (+ `http://localhost:${PORT}/*` p/ dev).
- **Web origins**: `https://${DOMAIN}`.
- IdP `azure-ad` já existe. Detalhes e validação do JWT no backend: ver `KEYCLOAK.md`.

Env do backend: `KEYCLOAK_URL=https://auth.deltainf.com.br`, `KEYCLOAK_REALM=Apps`,
`KEYCLOAK_CLIENT_ID=${APP}`, `KEYCLOAK_IDP_HINT=azure-ad`. (No DIC, a autorização — quem entra e
com qual papel — fica **na aplicação**, no Postgres, não em roles do realm.)

---

## 4. Arquivos do app (templates)

### `Dockerfile`

```dockerfile
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . ./
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
```

### `docker-compose.yml` (sem publicar porta no host — nginx alcança pelo nome)

```yaml
services:
  deltapp: # = APP (vira o nome do container / upstream do nginx)
    build: .
    container_name: deltapp
    restart: always
    env_file: .env
    extra_hosts:
      - 'host.docker.internal:host-gateway' # só se precisar falar com serviços do host/túnel
    networks: [network_public]
networks:
  network_public:
    external: true
```

### `.env.example` (segredos fora do git; `.env` no `.gitignore`)

```env
PORT=8080
PUBLIC_URL=https://deltapp.deltainf.com.br
DATABASE_URL=postgres://deltapp:***@postgres_central:5432/deltapp
# Keycloak (se houver login)
KEYCLOAK_URL=https://auth.deltainf.com.br
KEYCLOAK_REALM=Apps
KEYCLOAK_CLIENT_ID=deltapp
KEYCLOAK_IDP_HINT=azure-ad
```

### `.github/workflows/deploy.yml`

```yaml
name: Deploy VPS
on: { push: { branches: [main] }, workflow_dispatch: {} }
concurrency: { group: deploy-vps-deltapp, cancel-in-progress: false }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            set -e
            cd ~/deltapp
            git fetch origin main && git reset --hard origin/main
            docker compose up -d --build
            docker image prune -f
```

Cadastre os secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` no repositório (Settings → Secrets).

---

## 5. Subir o app na VPS

```bash
git clone https://github.com/deltagestaopublica/${APP}.git ~/${APP} && cd ~/${APP}
cp .env.example .env && nano .env         # preencher DATABASE_URL etc.
docker compose up -d --build
docker ps --filter name=${APP} --format '{{.Names}}: {{.Status}}'   # (healthy)
docker logs ${APP} --tail 30
```

---

## 6. nginx + TLS (padrão container/webroot)

Edite `~/apps/proxy/nginx.conf` e cole **dentro do `http { }`**. **Fase 1 — só o bloco HTTP**
(necessário para emitir o cert):

```nginx
    server {
        listen 80; listen [::]:80;
        server_name deltapp.deltainf.com.br;
        location /.well-known/acme-challenge/ { root /var/www/certbot; }
        location / { return 301 https://$host$request_uri; }
    }
```

Recarregue e emita o certificado:

```bash
cd ~/apps/proxy
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot -d deltapp.deltainf.com.br \
  --email infraestrutura@deltainf.com.br --agree-tos --no-eff-email
```

**Fase 2 — cole o bloco HTTPS** (proxy pelo **nome do container**) e recarregue de novo:

```nginx
    server {
        listen 443 ssl; listen [::]:443 ssl; http2 on;
        server_name deltapp.deltainf.com.br;
        ssl_certificate     /etc/letsencrypt/live/deltapp.deltainf.com.br/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/deltapp.deltainf.com.br/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3; ssl_prefer_server_ciphers off;
        client_max_body_size 32m;
        location / {
            proxy_pass         http://deltapp:8080;   # nome do container : porta interna
            proxy_http_version 1.1;
            proxy_set_header   Host              $host;
            proxy_set_header   X-Real-IP         $remote_addr;
            proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header   X-Forwarded-Proto $scheme;
            proxy_read_timeout 300s;
        }
    }
```

```bash
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
curl -sI https://deltapp.deltainf.com.br | head -3
```

---

## 7. Gotchas (aprendidos no DIC — não repita)

- **`net.ipv4.ip_forward`**: um `apt install` (pacote `linux-sysctl-defaults`) pode zerá-lo e
  **derrubar toda a rede Docker**. Fix: `sudo sysctl -w net.ipv4.ip_forward=1` + `sudo systemctl restart docker`.
  Permanente: `echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-ip-forward.conf && sudo sysctl --system`.
- **nginx em loop após restart em massa**: o `nginx.conf` resolve os upstreams no load; se um app
  ainda não subiu, o `nginx_proxy` fica reiniciando (`host not found in upstream`). Suba os apps,
  depois `docker restart nginx_proxy`. Garanta `restart: always` em todos os apps.
- **Porta**: não publique porta no host (proxy por nome de container). Se realmente publicar,
  cheque colisão (`ss -ltnp`), e deixe o HEALTHCHECK sensível a `PORT`.
- **Conexão com serviço do host/túnel** (ex.: Ollama on-prem): use `extra_hosts: host.docker.internal:host-gateway`
  e `http://host.docker.internal:<porta>`. Túnel SSH persistente no Windows deve rodar **sob a
  conta do usuário** (não SYSTEM). Chamadas HTTP muito longas (IA): use streaming e desative o
  `headersTimeout` do undici (ver `server/ingest/ia-motor.js` do DIC).
- **Segredos**: nunca no git. `.env` no `.gitignore`; `.env.example` versionado. Se vazou num
  commit, troque o segredo.
- **CSP**: se servir HTML próprio, prefira nonce nos scripts (o DIC faz isso no backend).

---

## 8. Checklist "pronto para produção"

- [ ] DNS do domínio → VPS.
- [ ] Banco/usuário criados no `postgres_central`.
- [ ] (se login) client no Keycloak + validação de JWT no backend.
- [ ] `Dockerfile` + `docker-compose.yml` (na `network_public`, `restart: always`, healthcheck).
- [ ] `.env` preenchido na VPS; `.env.example` no repo; segredos fora do git.
- [ ] Secrets `VPS_*` no GitHub + workflow de deploy.
- [ ] vhost no `nginx.conf` (HTTP → cert webroot → HTTPS) + reload.
- [ ] `curl -I https://DOMÍNIO` responde; container `(healthy)`.
- [ ] Auditoria/logs se houver dado sensível (LGPD).

---

## 9. Postgres de desenvolvimento compartilhado (rede Delta / VPN)

Alternativa ao Postgres local em Docker (`docker-compose.dev.yml` de cada projeto) pra quem está
na rede da Delta ou conectado na VPN: um Postgres já rodando em `192.168.2.228:5432`, usuário
`postgres`. Peça a senha pro Douglas por um canal que não vire log nem commit — **nunca cole a
senha real num arquivo do projeto, nem no `.env.example`** (só no `.env` local de cada um, que é
gitignored). Fora da rede/VPN da Delta, use o Postgres local em Docker normalmente.

Cada projeto ganha seu próprio banco lá dentro — nunca compartilha banco com outro projeto,
mesma lógica do `postgres_central` em produção:

```bash
createdb -h 192.168.2.228 -U postgres <nome-do-projeto>
```

No `.env` local (nunca no `.env.example`, que este sim vai pro git):

```env
DATABASE_URL=postgresql://postgres:SENHA@192.168.2.228:5432/<nome-do-projeto>
```

---

## Prompt do agente de deploy (cole no Claude do projeto a publicar)

```
Aja como meu "agente de deploy" para publicar ESTE projeto na VPS Delta, seguindo o
deploy-guide.md (mesmo padrão do DIC: Docker + network_public + postgres_central +
nginx_proxy com nginx.conf monolítico e certbot por webroot + deploy via GitHub Actions).

Faça nesta ordem, uma etapa por vez, esperando minha confirmação/saída entre elas:

1) INSPECIONE o projeto: linguagem/framework, como sobe (porta, comando), se tem login,
   quais serviços externos usa (bancos, APIs) e quais segredos precisa. Resuma.
2) Gere os COMANDOS DE CHECAGEM (seção 1 do guia) adaptados a este projeto (DNS, rede,
   postgres_central, nginx_proxy, ip_forward, colisão de nome/porta, e a conectividade
   aos serviços externos que ele usa). Eu rodo na VPS e te passo a saída.
3) Postgres: gere os comandos para criar banco/usuário (se usar banco).
4) (se houver login) passo a passo do client Keycloak no realm Apps.
5) Gere os ARQUIVOS adaptados: Dockerfile, docker-compose.yml (na network_public, SEM
   publicar porta no host, proxy pelo nome do container), .env.example, e o workflow
   .github/workflows/deploy.yml. Explique cada um.
6) Gere os blocos do nginx (HTTP p/ emitir cert + HTTPS) e os comandos certbot webroot.
7) Dê os SMOKE TESTS finais e um checklist "pronto para produção".

Regras: nunca commite direto na main (branch + PR); segredos fora do git; prefira o padrão
já existente do guia a inventar complexidade; me avise se algo do projeto violar o padrão.
```
