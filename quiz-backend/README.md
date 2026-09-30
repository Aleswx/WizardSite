# Quiz Leads Backend

API + banco SQLite pra receber os leads do quiz de inglês e alimentar um dashboard.

## Estrutura

```
quiz-backend/
├── server.js           # API (Express) e entrega do site
├── package.json
├── .env.example        # modelo de configuração local
├── leads.db            # criado automaticamente na primeira execução
├── archive/
│   └── quiz-standalone-original.html # versão antiga preservada
└── public/
  ├── index.html      # quiz integrado à API
  ├── dashboard.html  # painel de leads
  └── assets/         # imagens e arquivos estáticos
```

## Rodando localmente

```bash
cd quiz-backend
npm ci
cp .env.example .env
# troque o valor de DASHBOARD_API_KEY no .env
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
  "score": 11,
  "tier": "Nível Intermediário Avançado",
  "answers": [
    { "question": "Você está prestes a assistir uma série nova na Netflix. O que você faz?", "answer": "Assisto sem legenda nenhuma", "points": 2 },
    { "question": "Qual dessas frases quer dizer estou exausto?", "answer": "I'm beat", "points": 2 },
    { "question": "Chega um e-mail em inglês do trabalho. Sua reação:", "answer": "Leio rápido e entendo o essencial", "points": 1 },
    { "question": "Complete: I've been working here ___ three years.", "answer": "for", "points": 2 },
    { "question": "Você pede comida em um restaurante fora do Brasil. Como se sai?", "answer": "Peço com frases simples, meio decoradas", "points": 1 },
    { "question": "O que significa a expressão it's a piece of cake?", "answer": "É muito fácil", "points": 2 },
    { "question": "Alguém te chama pra uma call em inglês de última hora. Você:", "answer": "Entro, mas fico mais quieto ouvindo", "points": 1 }
  ]
}
```

## Configurando o Supabase

1. No SQL Editor do Supabase, execute [`supabase/add_answers_column.sql`](supabase/add_answers_column.sql) para adicionar a coluna JSONB às tabelas `public.leads` existentes.
2. Copie `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` das configurações do projeto para `quiz-backend/.env`. Configure também `DASHBOARD_API_KEY`.
3. Reinicie o backend. Quando as duas variáveis do Supabase estiverem definidas, novos leads e as sete respostas serão gravados na tabela `leads`; sem elas, o servidor usa SQLite local.

Mantenha `SUPABASE_SERVICE_ROLE_KEY` somente no ambiente do backend. Nunca a coloque no HTML ou em código enviado ao navegador.

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

## Quiz e assets

O arquivo servido na rota `/` é `public/index.html`. Ele envia leads para `/api/leads` no mesmo servidor. Os arquivos estáticos do site ficam em `public/assets/`.

## Acessando o dashboard

Abra `https://seu-backend.up.railway.app/dashboard.html`, informe a URL da API e a `DASHBOARD_API_KEY` que você definiu — fica salvo no localStorage do navegador pra não precisar digitar de novo.

## Segurança

- Troque `DASHBOARD_API_KEY` por um valor longo e aleatório antes de publicar
- Restrinja `ALLOWED_ORIGINS` ao domínio real do quiz em produção (evita que qualquer site poste leads falsos na sua API)
- O dashboard não tem autenticação de usuário além da API key — se quiser algo mais robusto (login por e-mail/senha, múltiplos usuários), dá pra evoluir depois
