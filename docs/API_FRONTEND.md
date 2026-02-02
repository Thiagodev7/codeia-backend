# 📘 CodeIA Backend - Documentação para Frontend

> **Versão:** 2.0  
> **Atualizado em:** 02/02/2026  
> **URL Base:** `http://localhost:3333`  
> **Swagger:** `http://localhost:3333/docs`

---

## 🔐 Autenticação

### Login

```http
POST /login
Content-Type: application/json

{
  "email": "admin@empresa.com",
  "password": "senha123"
}
```

**Resposta (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "name": "Nome do Admin",
    "email": "admin@empresa.com",
    "phone": "11999999999",
    "role": "ADMIN",
    "tenantId": "uuid"
  }
}
```

### Usando o Token

Todas as rotas protegidas requerem o header:

```http
Authorization: Bearer <token>
```

---

## 📄 Paginação (NOVO!)

As rotas de listagem agora suportam **paginação**:

### Query Params

| Param   | Tipo   | Default | Descrição                    |
| ------- | ------ | ------- | ---------------------------- |
| `page`  | number | 1       | Número da página (1-indexed) |
| `limit` | number | 20      | Itens por página (max: 100)  |

### Exemplo de Request

```http
GET /appointments?page=1&limit=20
Authorization: Bearer <token>
```

### Formato de Resposta Paginada

```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

## 📅 Agenda (Appointments)

### Listar Agendamentos (Paginado)

```http
GET /appointments?page=1&limit=20
```

**Resposta:**

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Consulta",
      "startTime": "2026-02-02T14:00:00.000Z",
      "endTime": "2026-02-02T15:00:00.000Z",
      "status": "SCHEDULED",
      "customer": {
        "id": "uuid",
        "name": "João Silva",
        "phone": "11999999999"
      },
      "service": {
        "name": "Corte de Cabelo",
        "price": 50.0
      }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
}
```

### Criar Agendamento

```http
POST /appointments
Content-Type: application/json

{
  "customerId": "uuid",
  "serviceId": "uuid",       // opcional
  "title": "Consulta",       // obrigatório se não tiver serviceId
  "startTime": "2026-02-05T14:00:00.000Z"
}
```

### Reagendar

```http
PUT /appointments/:id
Content-Type: application/json

{
  "newStartTime": "2026-02-06T15:00:00.000Z"
}
```

### Cancelar

```http
DELETE /appointments/:id
```

---

## 💬 CRM (Conversas)

### Listar Conversas (Paginado)

```http
GET /crm/conversations?page=1&limit=20
```

**Resposta:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Maria Santos",
      "phone": "11988888888",
      "lastMessage": "Olá, quero agendar...",
      "updatedAt": "2026-02-02T10:30:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 120, "totalPages": 6 }
}
```

> ⚡ **Ordenação automática:** Conversas são ordenadas pela mensagem mais recente.

### Histórico de Mensagens (Paginado)

```http
GET /crm/conversations/:customerId/messages?page=1&limit=50
```

**Resposta:**

```json
{
  "data": [
    {
      "id": "uuid",
      "role": "user",
      "content": "Olá, quero agendar um horário",
      "createdAt": "2026-02-02T10:00:00.000Z"
    },
    {
      "id": "uuid",
      "role": "assistant",
      "content": "Olá! Claro, temos horários disponíveis...",
      "createdAt": "2026-02-02T10:00:05.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 50, "total": 87, "totalPages": 2 }
}
```

---

## 📱 WhatsApp

### Listar Sessões

```http
GET /whatsapp/sessions
```

**Resposta:**

```json
[
  {
    "id": "uuid",
    "sessionName": "Principal",
    "status": "CONNECTED",
    "agentId": "uuid",
    "agentName": "Assistente de Vendas"
  }
]
```

### Status Possíveis

| Status         | Descrição                    |
| -------------- | ---------------------------- |
| `DISCONNECTED` | Não conectado                |
| `CONNECTING`   | Conectando...                |
| `QR_READY`     | QR Code disponível para scan |
| `CONNECTED`    | Conectado e funcionando      |

### Iniciar Sessão (Gerar QR Code)

```http
POST /whatsapp/sessions/:sessionId/start
```

**Resposta:**

```json
{
  "status": "QR_READY",
  "qr": "data:image/png;base64,iVBORw0KGgo..."
}
```

### Desconectar Sessão

```http
POST /whatsapp/sessions/:sessionId/stop
```

---

## 🤖 Agentes IA

### Listar Agentes

```http
GET /ai/agents
```

### Criar/Atualizar Agente

```http
POST /ai/agents
PUT /ai/agents/:id
Content-Type: application/json

{
  "name": "Assistente de Vendas",
  "slug": "vendas",
  "model": "gemini-2.0-flash-lite",
  "instructions": "Você é um assistente de vendas..."
}
```

---

## ⚙️ Configurações

### Obter Configurações do Tenant

```http
GET /settings
```

### Atualizar Configurações

```http
PUT /settings
Content-Type: application/json

{
  "businessName": "Minha Empresa",
  "primaryColor": "#06b6d4",
  "reminderEnabled": true,
  "reminderMinutes": 60
}
```

### Horários de Funcionamento

```http
GET /settings/business-hours
PUT /settings/business-hours

[
  { "dayOfWeek": 1, "startTime": "09:00", "endTime": "18:00", "isOpen": true },
  { "dayOfWeek": 2, "startTime": "09:00", "endTime": "18:00", "isOpen": true }
]
```

---

## ❌ Tratamento de Erros

Todos os erros seguem o formato:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "E-mail inválido",
  "details": { "field": "email" }
}
```

### Códigos Comuns

| Status | Code                 | Descrição                      |
| ------ | -------------------- | ------------------------------ |
| 400    | `VALIDATION_ERROR`   | Dados inválidos                |
| 401    | `UNAUTHORIZED`       | Token inválido/ausente         |
| 404    | `RESOURCE_NOT_FOUND` | Recurso não encontrado         |
| 409    | `CONFLICT`           | Conflito (ex: horário ocupado) |
| 500    | `INTERNAL_ERROR`     | Erro interno                   |

---

## 🔄 Mudanças Importantes (v2.0)

### 1. Paginação Obrigatória

As seguintes rotas agora retornam **resposta paginada**:

- `GET /appointments` ← **Breaking Change**
- `GET /crm/conversations` ← **Breaking Change**
- `GET /crm/conversations/:id/messages` ← **Breaking Change**

**Antes:**

```json
[ {...}, {...} ]
```

**Agora:**

```json
{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 } }
```

### 2. WebSocket para Status WhatsApp

> ⚠️ **Em breve:** Status real-time via WebSocket. Por enquanto, use polling.

---

## 🛠️ Ambiente de Desenvolvimento

### Requisitos

- Node.js 18+
- PostgreSQL
- **Redis** (NOVO - obrigatório para workers)

### Variáveis de Ambiente

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/codeia
JWT_SECRET=your-secret-key
REDIS_URL=redis://localhost:6379
GOOGLE_AI_KEY=your-gemini-api-key
```

---

## 📞 Suporte

Dúvidas? Entre em contato com o time de backend.
