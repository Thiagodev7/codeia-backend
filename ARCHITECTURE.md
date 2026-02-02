# Arquitetura do CodeIA Backend

## 📋 Visão Geral

O **CodeIA Backend** é uma API RESTful construída em **Fastify** que fornece infraestrutura para gerenciamento de agentes de IA com integração ao WhatsApp. O sistema segue uma arquitetura orientada a serviços com processamento assíncrono via workers.

### Principais Características

- 🏢 **Multi-tenancy**: Isolamento completo de dados por tenant.
- 🤖 **IA Agêntica**: Integração com Google Gemini com function calling.
- 📱 **WhatsApp Nativo**: Conexão via Baileys (não oficial, baseada em WebSocket).
- 📅 **Agendamento Inteligente**: IA pode criar/modificar agendamentos.
- 🔄 **Processamento Assíncrono**: Workers dedicados para tarefas pesadas.

---

## 🏗️ Arquitetura em Camadas

```mermaid
graph TD
    Client[Frontend / WhatsApp] --> API[API Layer (Fastify)]

    subgraph "API Server"
        API --> Auth[Auth Guard]
        Auth --> Routes[Routes Controllers]
        Routes --> Services[Service Layer]
    end

    subgraph "Async Workers"
        Services -.-> Queue[BullMQ (Redis)]
        Queue --> WAWorker[WhatsApp Worker]
        Cron[Cron Jobs] --> Reminder[Reminder Worker]
    end

    subgraph "Data Layer"
        Services --> Prisma[Prisma ORM]
        WAWorker --> Prisma
        Prisma --> DB[(PostgreSQL)]
        Services --> Cache[(Redis Cache)]
    end

    subgraph "External Services"
        WAWorker --> Baileys[Baileys Socket]
        Services --> Gemini[Google Gemini AI]
    end
```

---

## 🔄 Fluxos Principais (End-to-End)

### 1. Inicialização da Sessão WhatsApp

1. **Frontend**: Admin clica em "Conectar WhatsApp" (`POST /whatsapp/sessions`).
2. **API**: Valida limites do plano e cria registro `WhatsAppSession` com status `DISCONNECTED`.
3. **Frontend**: Solicita início (`POST /.../start`).
4. **API**: Enfileira job `START_SESSION` no Redis.
5. **WhatsApp Worker**:
   - Pega o job.
   - Instancia o cliente Baileys.
   - Gera QR Code e publica no canal Pub/Sub `session-status`.
6. **Frontend**: Recebe atualização via polling ou SSE (futuro) e exibe QR Code.
7. **Admin**: Escaneia QR Code.
8. **WhatsApp Worker**: Detecta conexão, atualiza status para `CONNECTED` no banco e memória.

### 2. Fluxo de Tratamento de Mensagens com IA

1. **Baileys**: Recebe evento `messages.upsert`.
2. **Worker**:
   - Ignora mensagens de status ou grupos (configurável).
   - Busca ou cria `Customer` pelo telefone.
   - Salva a mensagem recebida (`role: user`) no histórico.
3. **AI Service**:
   - Carrega últimas 10-20 mensagens do histórico.
   - Carrega contexto do Agente (Prompt do Sistema + Ferramentas disponíveis).
   - Envia tudo para o Google Gemini.
4. **Gemini (Function Calling)**:
   - Se o usuário pediu agendamento, Gemini retorna `functionCall: createAppointment`.
   - **AI Service**: Executa a função `AppointmentService.createAppointment()`.
   - **Resultado**: Agendamento criado no banco.
5. **Gemini (Resposta Final)**:
   - Recebe o resultado da função.
   - Gera resposta de texto natural: "Seu agendamento foi confirmado para..."
6. **Worker**:
   - Envia resposta de texto via Baileys.
   - Salva resposta (`role: assistant`) no histórico.

---

## 🧠 Decisões Arquiteturais

### Por que Fastify?

Escolhemos Fastify em vez do Express por performance (até 5x mais rápido), suporte nativo a Schema Validation (Zod) e arquitetura de plugins que facilita o encapsulamento de contextos (Multi-tenancy).

### Por que Baileys (vs API Oficial)?

A API Oficial do WhatsApp (Cloud API) cobra por conversa e exige processos burocráticos de verificação. Para o MVP e foco em PMEs, o Baileys permite usar o número existente do cliente sem custo por mensagem, simulando um WhatsApp Web.
_Trade-off_: Instabilidade ocasional requer gestão robusta de reconexão (implementada no Worker).

### Por que BullMQ?

O processamento de mensagens e sessões do WhatsApp é pesado e não deve bloquear a thread principal da API. Redis + BullMQ garante persistência, retries automáticos e desacoplamento.

---

## 📏 Padrões de Código

### Services & Dependency Injection

Não usamos Injeção de Dependência complexa (como NestJS) para manter a simplicidade. Instanciamos services diretamente ou usamos Classes estáticas/Singleton para Managers.

```typescript
// Pattern Padrão
export class UserService {
  constructor(private prisma = prismaClient) {} // Opcional: allow mock

  async create(data: CreateUserDTO) {
    // 1. Validate rules
    // 2. Database calls
    // 3. Return entity
  }
}
```

### Error Handling

Todo o sistema usa a classe `AppError` (`src/lib/errors.ts`).

- **NUNCA** lance erros genéricos (`throw new Error`).
- Use os helpers: `throw Errors.NotFound('Usuário não encontrado')`.
- O `error-handler.plugin.ts` captura tudo e formata o JSON padrão.

### Naming Conventions

- **Arquivos**: `kebab-case.ts` (ex: `user.controller.ts`, `auth-middleware.ts`).
- **Classes**: `PascalCase` (ex: `UserService`).
- **Variáveis/Funções**: `camelCase`.
- **Interfaces**: `PascalCase` (sem prefixo I).

---

## 🔧 Guia de Troubleshooting

### Problema: Sessão do WhatsApp travada em "QRCODE"

**Causa:** O worker pode ter reiniciado e perdido o socket, mas o status no banco ficou desatualizado.
**Solução:**

1. Chamar rota `POST /whatsapp/sessions/:id/stop` (força limpeza).
2. Tentar iniciar novamente.
3. Se falhar, deletar a sessão e criar outra.

### Problema: IA não responde

**Causa:** Chave da API do Gemini inválida ou quota excedida.
**Check:**

1. Verificar logs do backend procurando `GoogleGenerativeAIError`.
2. Confirmar se `GOOGLE_AI_KEY` no `.env` está correta.

### Problema: Worker não processa jobs

**Causa:** Redis caiu ou conexão falhou.
**Check:**

1. Verificar status do container Redis.
2. Reiniciar aplicação backend (`npm run dev`).

---

## 📚 Stack Tecnológico

| Camada | Tech | Detalhes |
|Data | PostgreSQL | Banco Relacional principal |
|ORM | Prisma | Schema-first, type-safe queries |
|Backend | Node.js + Fastify | Runtime e Framework Web |
|Validation | Zod | Validação de input e env vars |
|AI | Google Gemini Pro | LLM principal |
|Async | Redis + BullMQ | Filas e Pub/Sub |
|Docs | Swagger / OpenAPI | Documentação automática (`/docs`) |
