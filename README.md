# 🤖 CodeIA --- Backend SaaS de Automação para WhatsApp com IA (Gemini)

Plataforma SaaS completa para **automação de WhatsApp** integrada com
**Inteligência Artificial Google Gemini**, permitindo criação de
atendentes virtuais, fluxos inteligentes e gestão de múltiplas contas
WhatsApp.

## 🧩 Tecnologias Utilizadas

  Função               Tecnologia
  -------------------- --------------------------------
  **Runtime**          Node.js + TypeScript
  **Framework Web**    Fastify
  **ORM**              Prisma ORM
  **Banco de Dados**   PostgreSQL
  **IA**               Google Gemini 1.5 Flash
  **WhatsApp**         whatsapp-web.js (Multi-Device)
  **Docs API**         Swagger (OpenAPI 3.1)

## 📦 Estrutura do Projeto

    /src
     ├── modules
     │   ├── auth
     │   ├── users
     │   ├── ai
     │   ├── whatsapp
     │   └── shared
     ├── config
     ├── plugins
     ├── utils
     └── server.ts

## ⚙️ Como Rodar o Projeto

### 1️⃣ Instalar Dependências

``` bash
npm install
```

### 2️⃣ Configurar Variáveis de Ambiente

``` bash
cp .env.example .env
```

``` env
DATABASE_URL="postgresql://usuario:senha@localhost:5432/codeia"
JWT_SECRET="sua_chave_secreta"
GEMINI_API_KEY="sua_api_key_gemini"
```

### 3️⃣ Configurar Banco de Dados

``` bash
npx prisma db push
```

### 4️⃣ Rodar o Servidor em Desenvolvimento

``` bash
npm run dev
```

## 📚 Documentação da API

Acesse `/docs`.

## 🤖 Integração com IA (Gemini)

-   Gemini 1.5 Flash\
-   Respostas inteligentes\
-   Análise de contexto

## 💬 Integração WhatsApp (Multi-Device)

-   whatsapp-web.js\
-   QR Code\
-   Multi-sessões\
-   Automação com IA

## 🌱 Inicialização do Git

``` bash
git init
git branch -M main
git add .
git commit -m "feat: Initial commit - Project Structure with Auth, Prisma, AI and WhatsApp Manager"
```

## 🚀 Roadmap

-   Painel multi-tenant\
-   Filas de atendimento\
-   Templates inteligentes\
-   Logs e analytics avançados

## 🛡️ Licença

Projeto proprietário.
