# Guia Keycloak — Autenticação para Novos Sistemas

Documento de referência para configurar o Keycloak como provedor de autenticação (SSO com Office 365 / Azure AD) em qualquer linguagem ou framework.

---

## Índice

1. [Conceitos fundamentais](#1-conceitos-fundamentais)
2. [Configuração do Realm](#2-configuração-do-realm)
3. [Configuração do Client](#3-configuração-do-client)
4. [Configuração do Identity Provider (Azure AD)](#4-configuração-do-identity-provider-azure-ad)
5. [O fluxo OIDC passo a passo](#5-o-fluxo-oidc-passo-a-passo)
6. [PKCE — Por que usar e como funciona](#6-pkce--por-que-usar-e-como-funciona)
7. [Endpoints do Keycloak](#7-endpoints-do-keycloak)
8. [Estrutura do JWT](#8-estrutura-do-jwt)
9. [Validação do JWT no servidor](#9-validação-do-jwt-no-servidor)
10. [Refresh Token — renovação silenciosa](#10-refresh-token--renovação-silenciosa)
11. [Logout](#11-logout)
12. [Variáveis de ambiente necessárias](#12-variáveis-de-ambiente-necessárias)
13. [Checklist de configuração](#13-checklist-de-configuração)

---

## 1. Conceitos fundamentais

| Conceito                    | Descrição                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Realm**                   | Espaço isolado de configuração. Cada sistema ou grupo de sistemas pode ter seu próprio realm. Exemplo: realm `Apps` para todos os sistemas internos.                                                 |
| **Client**                  | Representa uma aplicação específica dentro do realm. Cada sistema precisa do seu próprio client. Exemplo: `delta-condesp`, `delta-financeiro`.                                                       |
| **Identity Provider (IdP)** | Provedor externo de identidade integrado ao Keycloak. No nosso caso, **Azure AD (Office 365)**. O Keycloak age como intermediário: autentica no Office 365 e emite seu próprio JWT para a aplicação. |
| **Access Token**            | JWT de curta duração (padrão: 5 minutos) que o cliente envia em cada requisição ao servidor.                                                                                                         |
| **Refresh Token**           | Token de longa duração (padrão: 30 minutos) usado para obter novos Access Tokens sem pedir login novamente.                                                                                          |
| **ID Token**                | JWT com informações do usuário (nome, email). Usado no logout para identificar a sessão.                                                                                                             |
| **JWKS**                    | Conjunto de chaves públicas do Keycloak. O servidor da aplicação baixa essas chaves para verificar a assinatura dos JWTs.                                                                            |

---

## 2. Configuração do Realm

Acesse o painel admin do Keycloak: `https://auth.deltainf.com.br` → selecione o realm `Apps` (ou crie um novo).

### Criar um novo realm (opcional)

1. Menu lateral → **Manage realms** → **Create realm**
2. **Realm name**: ex. `Apps`
3. **Enabled**: On
4. Salvar

### Configurações recomendadas do realm

Acesse **Realm settings**:

- **General → Display name**: nome legível do realm
- **Sessions → SSO Session Idle**: tempo de inatividade antes de expirar a sessão (ex: `30 minutes`)
- **Sessions → SSO Session Max**: tempo máximo de sessão (ex: `8 hours`)
- **Tokens → Access Token Lifespan**: duração do access token (ex: `5 minutes`)
- **Tokens → Refresh Token Max Reuse**: `0` (cada refresh token é de uso único)

---

## 3. Configuração do Client

No painel admin: **Clients → Create client**

### Passo 1 — General settings

| Campo           | Valor                                            |
| --------------- | ------------------------------------------------ |
| **Client type** | `OpenID Connect`                                 |
| **Client ID**   | Ex: `meu-sistema` (será usado nas chamadas OIDC) |
| **Name**        | Nome legível: ex. `Meu Sistema`                  |

### Passo 2 — Capability config

| Campo                     | Valor         | Motivo                                                                          |
| ------------------------- | ------------- | ------------------------------------------------------------------------------- |
| **Client authentication** | **Off**       | Client público — sem client_secret. Obrigatório para apps no browser ou mobile. |
| **Authorization**         | Off           |                                                                                 |
| **Standard flow**         | ✅ Marcado    | Habilita Authorization Code (o fluxo que usamos)                                |
| **Direct access grants**  | ❌ Desmarcado | Evita login por usuário/senha diretamente (menos seguro)                        |
| **Service account roles** | ❌ Desmarcado | Só necessário para integração máquina-a-máquina                                 |

### Passo 3 — Login settings

| Campo                               | Valor                                                                |
| ----------------------------------- | -------------------------------------------------------------------- |
| **Root URL**                        | URL raiz da aplicação: ex. `https://condesp.deltainf.com.br`         |
| **Home URL**                        | Ex. `https://condesp.deltainf.com.br`                                |
| **Valid redirect URIs**             | URLs permitidas após login. Ex: `https://condesp.deltainf.com.br/*`  |
| **Valid post logout redirect URIs** | URLs permitidas após logout. Ex: `https://condesp.deltainf.com.br/*` |
| **Web origins**                     | Para CORS. Ex: `https://condesp.deltainf.com.br`                     |

> **Atenção**: Em desenvolvimento, adicione também `http://localhost:3001/*` nas Valid redirect URIs.

### Passo 4 — Advanced (opcional mas recomendado)

- **Proof Key for Code Exchange Code Challenge Method**: `S256`
  - Força o uso de PKCE (mais seguro)

Salvar.

### Client de desenvolvimento compartilhado (`dltdevelop`)

Pra não travar ninguém esperando um client novo ser criado, existe um client compartilhado só
para desenvolvimento local: `KEYCLOAK_CLIENT_ID=dltdevelop` (mesmo realm `Apps`, mesmo IdP
`azure-ad`). Crie o client dedicado (passos acima) só na hora de publicar, seguindo
`deploy-guide.md` seção 3.

> **Testado na prática (2026-07-30)**: apesar de aparecer `http://localhost:*/*` nas Valid
> redirect URIs desse client, esse wildcard **não** aceita qualquer porta — testei e o Keycloak
> recusou com "Invalid parameter: redirect_uri" numa porta fora da lista literal. Só as portas
> cadastradas explicitamente funcionam de fato (ex.: `5183`, `3000`, `3001`, `3030`, `4300`,
> `8000`, `8080` — confira a lista atual em Clients → dltdevelop → Valid redirect URIs). O
> template do `/frontend` já usa `5183` como porta fixa do Vite por causa disso. Se sua porta
> local não estiver nessa lista, ou peça pro Douglas cadastrar `http://localhost:<porta>/*`, ou
> rode o frontend na `5183`.

---

## 4. Configuração do Identity Provider (Azure AD)

O Identity Provider conecta o Keycloak ao Office 365. O usuário autentica no Microsoft e o Keycloak recebe os dados.

### No portal Azure (portal.azure.com)

1. **Azure Active Directory → App registrations → New registration**
2. **Name**: ex. `Keycloak - Apps`
3. **Supported account types**: `Accounts in this organizational directory only`
4. **Redirect URI**:
   - Type: `Web`
   - URL: `https://auth.deltainf.com.br/realms/Apps/broker/azure-ad/endpoint`
   - _(substitua `azure-ad` pelo alias que você vai usar no Keycloak)_
5. **Register**

Após criado, anote:

- **Application (client) ID** → será o `Client ID` no Keycloak
- **Directory (tenant) ID** → usado na URL do emissor

Em **Certificates & secrets → New client secret**:

- Crie um secret e copie o **Value** (aparece só uma vez)

Em **API permissions**:

- Confirme que `User.Read` (Microsoft Graph) está presente e com consentimento concedido

### No Keycloak

**Identity Providers → Add provider → OpenID Connect v1.0**

| Campo              | Valor                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------- |
| **Alias**          | `azure-ad` _(este nome vai no `KEYCLOAK_IDP_HINT` da aplicação)_                      |
| **Display name**   | `Office 365`                                                                          |
| **Discovery URL**  | `https://login.microsoftonline.com/<TENANT_ID>/v2.0/.well-known/openid-configuration` |
| **Client ID**      | Application ID copiado do Azure                                                       |
| **Client Secret**  | Secret copiado do Azure                                                               |
| **Default Scopes** | `openid email profile`                                                                |

Após salvar, vá em **Mappers → Add mapper**:

| Mapper | Tipo               | Claim externo        | Atributo Keycloak    |
| ------ | ------------------ | -------------------- | -------------------- |
| Email  | Attribute Importer | `email`              | `email`              |
| Nome   | Attribute Importer | `name`               | `name`               |
| UPN    | Attribute Importer | `preferred_username` | `preferred_username` |

---

## 5. O fluxo OIDC passo a passo

O fluxo usado é **Authorization Code com PKCE**. Abaixo, cada etapa em detalhe:

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐         ┌───────────┐
│  Navegador  │         │  Aplicação   │         │  Keycloak   │         │ Office365 │
│  (usuário)  │         │  (backend)   │         │             │         │ (Azure AD)│
└──────┬──────┘         └──────┬───────┘         └──────┬──────┘         └─────┬─────┘
       │                       │                        │                       │
       │  1. Clica em "Entrar" │                        │                       │
       │──────────────────────>│                        │                       │
       │                       │                        │                       │
       │  2. Gera code_verifier + code_challenge (PKCE) │                       │
       │     Redireciona para /authorize                │                       │
       │<──────────────────────│                        │                       │
       │                       │                        │                       │
       │  3. GET /authorize?client_id=...&code_challenge=...&kc_idp_hint=azure-ad
       │──────────────────────────────────────────────>│                       │
       │                       │                        │                       │
       │                       │                        │  4. Redireciona para  │
       │                       │                        │     login Microsoft   │
       │<────────────────────────────────────────────────────────────────────>│
       │                       │                        │                       │
       │  5. Usuário loga no Office 365                 │                       │
       │──────────────────────────────────────────────────────────────────────>│
       │                       │                        │                       │
       │  6. Microsoft retorna para o Keycloak com code │                       │
       │<────────────────────────────────────────────────────────────────────>│
       │                       │                        │                       │
       │  7. Keycloak redireciona para redirect_uri com ?code=ABC              │
       │<──────────────────────────────────────────────│                       │
       │                       │                        │                       │
       │  8. App troca o code + code_verifier por tokens│                       │
       │──────────────────────────────────────────────>│                       │
       │                       │                        │                       │
       │  9. Keycloak retorna access_token + refresh_token + id_token          │
       │<──────────────────────────────────────────────│                       │
       │                       │                        │                       │
       │  10. App salva tokens e redireciona para a aplicação                  │
       │──────────────────────>│                        │                       │
       │                       │                        │                       │
       │  11. Chamadas à API com Bearer token           │                       │
       │──────────────────────>│                        │                       │
       │                       │  12. Valida JWT via JWKS                      │
       │                       │──────────────────────>│                       │
       │                       │                        │                       │
```

---

## 6. PKCE — Por que usar e como funciona

**PKCE** (Proof Key for Code Exchange) protege o fluxo contra interceptação do `code` de autorização. É obrigatório para clients públicos (sem client_secret).

### Funcionamento

```
1. Gerar code_verifier
   → String aleatória de 43-128 caracteres (base64url)
   → Guardar no localStorage/sessionStorage

2. Calcular code_challenge
   → SHA-256(code_verifier) → base64url
   → Enviar no passo /authorize

3. Na troca do código (POST /token)
   → Enviar o code_verifier original
   → Keycloak verifica: SHA-256(verifier) == challenge enviado antes
   → Se não bater, rejeita a troca
```

### Implementação em qualquer linguagem

```
// Pseudocódigo
verifier  = random_bytes(48) → base64url_encode   // ~64 chars
challenge = sha256(verifier)  → base64url_encode

// Parâmetros no /authorize
code_challenge        = challenge
code_challenge_method = "S256"

// Parâmetros no /token
code_verifier = verifier
```

---

## 7. Endpoints do Keycloak

Base: `https://auth.deltainf.com.br/realms/Apps/protocol/openid-connect`

| Endpoint    | Método | Uso                                                |
| ----------- | ------ | -------------------------------------------------- |
| `/auth`     | GET    | Iniciar login — redireciona o usuário              |
| `/token`    | POST   | Trocar code por tokens / renovar com refresh_token |
| `/logout`   | GET    | Encerrar sessão no Keycloak                        |
| `/certs`    | GET    | Chaves públicas JWKS para validar JWTs             |
| `/userinfo` | GET    | Dados do usuário (requer Bearer token)             |

### Discovery Document

Todos os endpoints são listados automaticamente em:

```
https://auth.deltainf.com.br/realms/Apps/.well-known/openid-configuration
```

Use esse URL para configurar bibliotecas OIDC automaticamente.

### GET /auth — Parâmetros principais

| Parâmetro               | Obrigatório | Descrição                                                                       |
| ----------------------- | ----------- | ------------------------------------------------------------------------------- |
| `client_id`             | ✅          | ID do client configurado no Keycloak                                            |
| `response_type`         | ✅          | Sempre `code`                                                                   |
| `scope`                 | ✅          | `openid email profile`                                                          |
| `redirect_uri`          | ✅          | URL de callback (deve estar nas Valid redirect URIs)                            |
| `code_challenge`        | ✅          | Hash PKCE do code_verifier                                                      |
| `code_challenge_method` | ✅          | `S256`                                                                          |
| `kc_idp_hint`           | ⚡          | Alias do Identity Provider — pula a tela do Keycloak e vai direto ao Office 365 |
| `state`                 | Recomendado | Valor aleatório para proteção CSRF                                              |
| `nonce`                 | Recomendado | Valor aleatório para proteção contra replay                                     |

### POST /token — Troca do código

```
Content-Type: application/x-www-form-urlencoded

grant_type    = authorization_code
client_id     = meu-sistema
code          = <code recebido no callback>
redirect_uri  = <mesma URI usada no /authorize>
code_verifier = <verifier gerado no início>
```

**Resposta:**

```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "id_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 300
}
```

### POST /token — Renovação com refresh_token

```
grant_type    = refresh_token
client_id     = meu-sistema
refresh_token = <refresh_token salvo>
```

---

## 8. Estrutura do JWT

O `access_token` é um JWT assinado pelo Keycloak. Decodificado (base64url do payload), contém:

```json
{
  "exp": 1747600000,
  "iat": 1747599700,
  "jti": "uuid-do-token",
  "iss": "https://auth.deltainf.com.br/realms/Apps",
  "aud": "meu-sistema",
  "sub": "uuid-do-usuário",
  "typ": "Bearer",
  "azp": "meu-sistema",
  "session_state": "uuid-da-sessão",
  "name": "Douglas Rauber",
  "preferred_username": "douglas@deltainf.com.br",
  "email": "douglas@deltainf.com.br",
  "email_verified": true,
  "realm_access": {
    "roles": ["default-roles-apps", "offline_access"]
  }
}
```

| Campo                | Uso                                                                   |
| -------------------- | --------------------------------------------------------------------- |
| `sub`                | ID único do usuário (UUID estável — use como chave primária no banco) |
| `email`              | Email do usuário                                                      |
| `name`               | Nome completo                                                         |
| `preferred_username` | Username (geralmente o email no Azure AD)                             |
| `exp`                | Expiração em Unix timestamp — verifique antes de usar                 |
| `iss`                | Emissor — deve bater com `{KEYCLOAK_URL}/realms/{REALM}`              |
| `aud`                | Audience — deve bater com o `client_id` da aplicação                  |
| `realm_access.roles` | Roles do realm atribuídas ao usuário                                  |

> **Autenticação × autorização**: `realm_access.roles` traz papéis genéricos do Keycloak
> (`default-roles-apps`, `offline_access` etc.) — não modele permissão de negócio aqui. O
> Keycloak resolve **autenticação** (quem é a pessoa); **autorização** (o que ela pode fazer
> dentro do sistema) é responsabilidade de cada aplicação, guardada no seu próprio Postgres e
> associada ao `sub` do token.

---

## 9. Validação do JWT no servidor

**Nunca confie no JWT sem validar a assinatura.** O servidor deve:

1. Baixar as chaves públicas do endpoint `/certs` (JWKS)
2. Verificar a assinatura do token com essas chaves
3. Verificar `iss` (emissor)
4. Verificar `aud` (audience)
5. Verificar `exp` (expiração)

### Exemplos por linguagem

#### Node.js (biblioteca `jose`)

```js
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://auth.deltainf.com.br/realms/Apps/protocol/openid-connect/certs'),
);

const { payload } = await jwtVerify(token, JWKS, {
  issuer: 'https://auth.deltainf.com.br/realms/Apps',
  audience: 'meu-sistema',
});

const userId = payload.sub;
const email = payload.email;
```

#### Python (biblioteca `python-jose`)

```python
from jose import jwt
import requests

def get_jwks():
    url = "https://auth.deltainf.com.br/realms/Apps/protocol/openid-connect/certs"
    return requests.get(url).json()

def validate_token(token: str) -> dict:
    jwks = get_jwks()
    payload = jwt.decode(
        token,
        jwks,
        algorithms=["RS256"],
        audience="meu-sistema",
        issuer="https://auth.deltainf.com.br/realms/Apps",
    )
    return payload
```

#### Java (biblioteca `nimbus-jose-jwt`)

```java
import com.nimbusds.jose.jwk.source.*;
import com.nimbusds.jose.proc.*;
import com.nimbusds.jwt.proc.*;

JWKSource<SecurityContext> keySource = JWKSourceBuilder
    .create(new URL("https://auth.deltainf.com.br/realms/Apps/protocol/openid-connect/certs"))
    .build();

ConfigurableJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keySource));

JWTClaimsSet claims = processor.process(token, null);
String userId = claims.getSubject();
String email  = claims.getStringClaim("email");
```

#### PHP (biblioteca `firebase/php-jwt`)

```php
use Firebase\JWT\JWT;
use Firebase\JWT\JWK;

$jwks = json_decode(file_get_contents(
    'https://auth.deltainf.com.br/realms/Apps/protocol/openid-connect/certs'
), true);

$keys    = JWK::parseKeySet($jwks);
$payload = JWT::decode($token, $keys);

$userId = $payload->sub;
$email  = $payload->email;
```

> **Dica**: Faça cache das chaves JWKS por pelo menos 5 minutos. Elas mudam raramente e buscar a cada requisição desperdiça recursos.

---

## 10. Refresh Token — renovação silenciosa

O access_token expira em ~5 minutos. Para não forçar novo login, use o refresh_token:

```
Antes de cada requisição:
  1. Decodificar o access_token (sem validar assinatura — só ler o exp)
  2. Se exp < agora + 30s → renovar
  3. POST /token com grant_type=refresh_token
  4. Salvar os novos tokens
  5. Se o refresh falhar (expirou) → redirecionar para login
```

O refresh_token também expira (padrão: 30 minutos de inatividade). Se o usuário ficar inativo por mais tempo, precisará logar novamente.

---

## 11. Logout

O logout correto tem duas etapas:

1. **Local**: apagar tokens do storage (localStorage, cookie, etc.)
2. **Keycloak**: invalidar a sessão no servidor (evita que outros apps do mesmo realm continuem logados)

### Endpoint de logout

```
GET /realms/Apps/protocol/openid-connect/logout
  ?client_id=meu-sistema
  &post_logout_redirect_uri=https://meu-sistema.deltainf.com.br/login
  &id_token_hint=<id_token salvo>
```

O `id_token_hint` é importante: permite ao Keycloak identificar a sessão correta sem pedir confirmação ao usuário.

---

## 12. Variáveis de ambiente necessárias

Para qualquer sistema novo que use este Keycloak:

```env
# URL base do Keycloak (sem barra no final)
KEYCLOAK_URL=https://auth.deltainf.com.br

# Nome do realm
KEYCLOAK_REALM=Apps

# Client ID no Keycloak. Em desenvolvimento local, use o client compartilhado "dltdevelop"
# (ver seção 3) — evita depender de criar um client antes de começar a codar. Em produção,
# troque pelo client dedicado do sistema, criado seguindo o deploy-guide.md.
KEYCLOAK_CLIENT_ID=dltdevelop

# Alias do Identity Provider (pula tela do Keycloak, vai direto ao Office 365)
KEYCLOAK_IDP_HINT=azure-ad
```

---

## 13. Checklist de configuração

### No Keycloak

- [ ] Realm criado e configurado
- [ ] Client criado com `Client authentication: Off` (public)
- [ ] `Standard flow` marcado
- [ ] `Valid redirect URIs` com a URL do sistema + `/*`
- [ ] `Web origins` com a URL do sistema (CORS)
- [ ] Identity Provider Azure AD configurado com `alias: azure-ad`
- [ ] Mappers configurados: email, name, preferred_username

### No Azure AD

- [ ] App registration criado
- [ ] Redirect URI: `https://auth.deltainf.com.br/realms/Apps/broker/azure-ad/endpoint`
- [ ] Client secret gerado e copiado para o Keycloak
- [ ] Permissão `User.Read` concedida

### No sistema

- [ ] Variáveis de ambiente configuradas
- [ ] Fluxo PKCE implementado no frontend
- [ ] Validação do JWT no backend (iss + aud + exp + assinatura via JWKS)
- [ ] Renovação automática com refresh_token
- [ ] Logout implementado (local + Keycloak)
- [ ] `sub` do JWT usado como ID único do usuário no banco
- [ ] Autorização (papéis/permissões) implementada na aplicação/Postgres — não em roles do
      Keycloak
- [ ] Em produção, client dedicado criado (não o `dltdevelop` de desenvolvimento)
