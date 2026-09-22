# Quiz Leads Backend

API + banco SQLite pra receber os leads do quiz de inglês e alimentar um dashboard.

## Estrutura

```
quiz-backend/
├── server.js           # API (Express)
├── package.json
├── .env.example
├── leads.db            # criado automaticamente na primeira execução
└── public/
    └── dashboard.html  # painel de leads (servido pelo próprio Express)
```

## Rodando localmente

```bash
cd quiz-backend
npm install
cp .env.example .env
# edite o .env e defina um DASHBOARD_API_KEY forte
npm start
```

O servidor sobe em `http://localhost:3000`.
- Dashboard: `http://localhost:3000/dashboard.html`
- Health check: `http://localhost:3000/api/health`

## Endpoints

| Método | Rota           | Auth               | Descrição                              |
|--------|----------------|--------------------|-----------------------------------------|
| POST   | `/api/leads`   | pública            | Quiz envia um lead novo                 |
| GET    | `/api/leads`   | `x-api-key` header | Lista todos os leads (pro dashboard)    |
| GET    | `/api/stats`   | `x-api-key` header | Totais, distribuição por nível, série no tempo |

Corpo esperado do `POST /api/leads`:

```json
{
  "name": "Maria Silva",
  "email": "maria@email.com",
  "phone": "51999998888",
  "score": 10,
  "tier": "Nível Intermediário Avançado"
}
```

## Deploy (escolha uma)

Qualquer uma dessas plataformas tem plano gratuito e suporta Node + disco persistente (necessário pro arquivo `leads.db`):

### Railway (mais simples)
1. Crie um repositório no GitHub com esta pasta
2. No Railway, "New Project" → "Deploy from GitHub repo"
3. Em "Variables", adicione `DASHBOARD_API_KEY` e `ALLOWED_ORIGINS`
4. Railway detecta o `package.json` e faz o build sozinho
5. Ative um "Volume" apontando pra pasta do projeto, pra o `leads.db` não se perder a cada deploy

### Render
1. "New Web Service" → conecte o repositório
2. Build command: `npm install` | Start command: `npm start`
3. Adicione as variáveis de ambiente em "Environment"
4. Adicione um "Disk" persistente montado na raiz do projeto (senão o SQLite reseta a cada deploy)

### Fly.io
1. `fly launch` na pasta do projeto
2. `fly volumes create data --size 1` e monte em `/app` no `fly.toml`
3. `fly deploy`

> Se o volume de leads crescer muito ou você quiser mais robustez, o `server.js` foi escrito de um jeito fácil de trocar `better-sqlite3` por Postgres (ex: via Supabase ou o Postgres do próprio Railway) — a lógica das rotas continua igual, só troca a camada de banco.

## Conectando o quiz

No arquivo do quiz (`quiz-nivel-ingles.html`), defina a constante `API_BASE_URL` com a URL do backend publicado (ex: `https://seu-backend.up.railway.app`). O quiz já está preparado pra mandar um `POST /api/leads` quando o formulário é enviado.

## Acessando o dashboard

Abra `https://seu-backend.up.railway.app/dashboard.html`, informe a URL da API e a `DASHBOARD_API_KEY` que você definiu — fica salvo no localStorage do navegador pra não precisar digitar de novo.

## Segurança

- Troque `DASHBOARD_API_KEY` por um valor longo e aleatório antes de publicar
- Restrinja `ALLOWED_ORIGINS` ao domínio real do quiz em produção (evita que qualquer site poste leads falsos na sua API)
- O dashboard não tem autenticação de usuário além da API key — se quiser algo mais robusto (login por e-mail/senha, múltiplos usuários), dá pra evoluir depois
