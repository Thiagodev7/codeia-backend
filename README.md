# 🤖 CodeIA Backend

> **Versão 2.0:** Arquitetura Distribuída Escalável

Plataforma SaaS para **automação de WhatsApp** integrada com **IA (Gemini)**, projetada para alta performance e escalabilidade.

## 🚀 Novidades na v2.0

- **Arquitetura Distribuída:** Separação entre API e Workers (WhatsApp/Reminder).
- **Filas de Processamento:** Uso de **BullMQ + Redis** para gestão de tarefas assíncronas.
- **Escalabilidade:** Conexões WhatsApp isoladas da API principal.
- **Resiliência:** Tratamento de falhas, retries automáticos e Graceful Shutdown.
- **Performance:** Queries otimizadas com índices e Raw SQL.
- **Qualidade:** Testes unitários e de integração automatizados.

---

## 🧩 Stack Tecnológica

| Camada              | Tecnologia                          |
| ------------------- | ----------------------------------- |
| **Runtime**         | Node.js 20+ (TypeScript)            |
| **API Framework**   | Fastify                             |
| **Database**        | PostgreSQL + Prisma ORM             |
| **Queues/Cache**    | **Redis** + BullMQ                  |
| **WhatsApp Engine** | Baileys (via Workers)               |
| **AI**              | Google Gemini (1.5 Flash/2.0 Flash) |
| **Testes**          | Vitest + Supertest                  |

---

## 📦 Arquitetura do Projeto

```
src/
 ├── services/             # Lógica de negócios e Workers
 │   ├── whatsapp.worker.ts  # Worker dedicado ao WhatsApp (Baileys)
 │   ├── reminder.worker.ts  # Worker de agendamentos (Cron Job)
 │   └── ...
 ├── lib/                  # Configurações globais
 │   ├── queues.ts           # Definição das filas BullMQ
 │   ├── redis.ts            # Conexão Redis
 │   └── ...
 ├── routes/               # Rotas da API (Fastify)
 ├── __tests__/            # Testes Automatizados
 │   ├── unit/               # Testes unitários
 │   └── integration/        # Testes de integração (API)
 └── server.ts             # Entrypoint
```

---

## ⚙️ Configuração e Instalação

### Pré-requisitos

- Node.js 18+
- PostgreSQL
- **Redis** (Obrigatório para filas e cache)

### 1. Clonar e Instalar

```bash
git clone https://github.com/seu-repo/codeia-backend.git
cd codeia-backend
npm install
```

### 2. Variáveis de Ambiente

Copie o `.env.example` para `.env`:

```bash
cp .env.example .env
```

Configurações essenciais:

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/codeia_db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="sua_chave_segura"
GOOGLE_AI_KEY="sua_gemini_api_key"
```

### 3. Banco de Dados

Aplicar migrations e índices:

```bash
npx prisma migrate dev
```

### 4. Rodar o Projeto

**Modo Desenvolvimento:**

```bash
npm run dev
# Inicia API + Workers em paralelo
```

**Modo Produção:**

```bash
npm run build
npm start
```

---

## 🧪 Testes

O projeto utiliza **Vitest** para testes de alta performance.

| Comando                 | Descrição                             |
| ----------------------- | ------------------------------------- |
| `npm test`              | Roda testes em modo watch             |
| `npm run test:run`      | Roda todos os testes uma vez          |
| `npm run test:coverage` | Gera relatório de cobertura de código |

**Cobertura Atual:**

- ✅ Unitários: Services, Libs e Helpers
- ✅ Integração: Rotas de Autenticação

---

## 📚 Documentação da API

Quando o servidor estiver rodando, acesse:

- **Swagger UI:** `http://localhost:3333/docs`
- **Guia Frontend:** Veja [`docs/API_FRONTEND.md`](./docs/API_FRONTEND.md) para detalhes de integração.

---

## � Roadmap

- [x] Arquitetura de Workers (WhatsApp)
- [x] Sistema de Filas (BullMQ)
- [x] Testes Automatizados
- [x] Otimização de Performance (Índices/SQL)
- [ ] Dashboard de Monitoramento (Bull Board)
- [ ] Webhooks para eventos externos
- [ ] Suporte a envio de mídia (imagem/áudio)

---

## 🛡️ Licença

Projeto proprietário. Todos os direitos reservados.
