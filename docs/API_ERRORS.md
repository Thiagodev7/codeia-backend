# Catálogo de Erros da API CodeIA

Este documento descreve como a API comunica problemas e erros aos clientes. A padronização facilita o tratamento de exceções no frontend e em integrações.

## 📦 Estrutura Padrão de Erro

Todas as respostas de erro seguem o mesmo formato JSON:

```json
{
  "error": "BAD_REQUEST",
  "message": "Descrição amigável do erro",
  "statusCode": 400,
  "details": {
    "field": "email",
    "reason": "invalid_format"
  }
}
```

### Campos

| Campo        | Tipo   | Descrição                                                        |
| ------------ | ------ | ---------------------------------------------------------------- |
| `error`      | String | Código interno do erro (ex: `UNAUTHORIZED`, `VALIDATION_ERROR`). |
| `message`    | String | Mensagem descritiva para desenvolvedores ou usuários.            |
| `statusCode` | Number | Código HTTP correspondente (redundante, mas útil para debug).    |
| `details`    | Object | (Opcional) Metadados adicionais, comum em erros de validação.    |

---

## 🚦 Status Codes HTTP

| Código | Significado           | Quando ocorre                                                                     |
| ------ | --------------------- | --------------------------------------------------------------------------------- |
| `400`  | **Bad Request**       | Sintaxe inválida, campos faltando, validação falhou (Zod).                        |
| `401`  | **Unauthorized**      | Token JWT ausente, inválido ou expirado.                                          |
| `403`  | **Forbidden**         | Usuário autenticado mas sem permissão (ex: Plano Free tentando usar Recurso Pro). |
| `404`  | **Not Found**         | Recurso não encontrado (ID inexistente, Rota errada).                             |
| `409`  | **Conflict**          | Conflito de estado (ex: Email já cadastrado, Agendamento duplicado).              |
| `429`  | **Too Many Requests** | Limite de taxa excedido (Rate Limiting).                                          |
| `500`  | **Internal Error**    | Erro inesperado no servidor. Contate o suporte.                                   |

---

## 📚 Catálogo de Códigos de Erro

### Erros Genéricos

| Código                  | Status | Descrição                              |
| ----------------------- | ------ | -------------------------------------- |
| `BAD_REQUEST`           | 400    | Erro genérico de requisição incorreta. |
| `GENERIC_ERROR`         | 400    | Erro não especificado (fallback).      |
| `RESOURCE_NOT_FOUND`    | 404    | O recurso solicitado não existe.       |
| `INTERNAL_SERVER_ERROR` | 500    | Falha crítica não tratada.             |

### Autenticação e Permissões

| Código         | Status | Descrição                                                     |
| -------------- | ------ | ------------------------------------------------------------- |
| `UNAUTHORIZED` | 401    | Credenciais inválidas ou token JWT problemático.              |
| `FORBIDDEN`    | 403    | Ação proibida pelas regras de negócio (ex: Limites do plano). |

### Validação (Zod)

Quando ocorre erro de validação nos dados de entrada, o código geralmente é `validation_error` (ou similar gerado pelo Fastify/Zod) e o campo `details` contém a lista de problemas.

**Exemplo de Resposta de Validação:**

```json
{
  "statusCode": 400,
  "code": "FST_ERR_VALIDATION",
  "error": "Bad Request",
  "message": "body/email must be email",
  "details": [
    {
      "instancePath": "/email",
      "schemaPath": "#/properties/email/format",
      "keyword": "format",
      "params": {
        "format": "email"
      },
      "message": "must match format \"email\""
    }
  ]
}
```

_(Nota: O formato exato de validação depende da configuração do `fastify-type-provider-zod`, mas geralmente retornamos status 400)._

### Conflitos de Negócio

| Código     | Status | Descrição                                    |
| ---------- | ------ | -------------------------------------------- |
| `CONFLICT` | 409    | Violação de unicidade (ex: Email duplicado). |

---

## 🛠 Como Tratar no Frontend

Recomendamos usar um interceptor no cliente HTTP (Axios/Ky/Fetch) para tratar erros globalmente:

1. **401 (Unauthorized):** Redirecionar para `/login`.
2. **403 (Forbidden):** Mostrar aviso de "Sem Permissão" ou Upsell (Upgrade de Plano).
3. **400/409/422:** Mostrar a mensagem `message` em um Toast/Alerta para o usuário corrigir a ação.
4. **500:** Mostrar tela amigável de "Ops, algo deu errado".

```typescript
// Exemplo de Tratamento (Frontend)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.location.href = '/login'
    }
    if (error.response?.data?.message) {
      toast.error(error.response.data.message)
    }
    return Promise.reject(error)
  }
)
```
