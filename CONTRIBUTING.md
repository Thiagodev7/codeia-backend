# Como Contribuir para o CodeIA

Obrigado por considerar contribuir com o CodeIA! Este documento fornece diretrizes para manter a qualidade do código.

## 🎯 Padrões de Qualidade

### Code Style

- **TypeScript**: Use sempre tipos explícitos, evite `any`
- **Formatação**: Código deve ser formatado com Prettier (automático via pre-commit hook)
- **Nomenclatura**:
  - **Classes**: `PascalCase` (ex: `AIService`)
  - **Funções/Variáveis**: `camelCase` (ex: `handleMessage`)
  - **Constantes**: `UPPER_SNAKE_CASE` (ex: `MAX_RETRIES`)
  - **Arquivos**: `kebab-case.ts` ou `PascalCase.ts` para classes

### Estrutura de Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
tipo(escopo): descrição curta

Descrição detalhada (opcional)
```

**Tipos permitidos:**

- `feat`: Nova funcionalidade
- `fix`: Correção de bug
- `docs`: Apenas documentação
- `style`: Formatação (sem mudança de lógica)
- `refactor`: Refatoração
- `perf`: Melhoria de performance
- `test`: Adição/correção de testes
- `chore`: Manutenção (deps, config, etc)

**Exemplos:**

```bash
feat(auth): adicionar autenticação via Google OAuth
fix(whatsapp): corrigir reconexão automática após desconexão
docs(readme): atualizar instruções de instalação
```

### Validação e Type Safety

1. **Variáveis de Ambiente**: Adicionar em `src/lib/env.ts` com validação Zod
2. **DTOs**: Criar schemas em `src/lib/dtos.ts` para validação de entrada
3. **Tipos**: Exportar tipos inferidos dos schemas Zod

### Testes

- **Unitários**: Testar lógica de negócio isolada
- **Integração**: Testar fluxos completos de API
- **Cobertura mínima**: 80%

Execute os testes:

```bash
npm test              # Modo watch
npm run test:coverage # Com coverage
```

### Documentação

#### JSDoc

Adicione comentários JSDoc em:

- Funções públicas/exportadas
- Lógica complexa
- Funções com múltiplos parâmetros

Exemplo:

```typescript
/**
 * Processa mensagem do WhatsApp e retorna resposta da IA
 * @param agentId - ID do agente que vai responder
 * @param message - Texto da mensagem do usuário
 * @param context - Contexto da conversa (tenant, cliente, etc)
 * @returns Resposta da IA ou null se agente inativo
 */
async function processMessage(/*...*/) {
  // ...
}
```

#### Arquitetura

- Mudanças estruturais devem ser documentadas em `ARCHITECTURE.md`
- Novas features importantes devem ter seção no README

## 🔄 Workflow de Contribuição

### 1. Fork e Clone

```bash
git clone https://github.com/seu-usuario/codeia-backend.git
cd codeia-backend
npm install
```

### 2. Crie uma Branch

```bash
git checkout -b feat/minha-nova-feature
```

### 3. Desenvolva

- Escreva código limpo e testável
- Adicione testes para novas funcionalidades
- Atualize documentação se necessário

### 4. Verifique Qualidade

```bash
npm run format:check   # Verifica formatação
npm run build         # Verifica compilação
npm test              # Roda testes
```

### 5. Commit e Push

```bash
git add .
git commit -m "feat(escopo): descrição"
git push origin feat/minha-nova-feature
```

O pre-commit hook vai formatar automaticamente o código.

### 6. Abra Pull Request

- Use o template de PR
- Preencha todas as seções relevantes
- Aguarde review

## 🚫 O Que Evitar

- ❌ Commits direto na `main`
- ❌ Código sem testes
- ❌ Uso de `any` sem justificativa
- ❌ Secrets hardcoded
- ❌ Console.log em produção (use `logger`)
- ❌ Funções com > 50 linhas (considere refatorar)

## ✅ Boas Práticas

- ✅ Funções pequenas e com responsabilidade única
- ✅ Nomes descritivos de variáveis e funções
- ✅ Tratamento de erros adequado
- ✅ Validação de entrada com Zod
- ✅ Logs estruturados com Pino
- ✅ Isolamento de contexto (multi-tenancy)

## 📚 Recursos

- [Documentação TypeScript](https://www.typescriptlang.org/docs/)
- [Zod Documentation](https://zod.dev/)
- [Fastify Best Practices](https://fastify.dev/docs/latest/Guides/Best-Practices/)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)

## ❓ Dúvidas

Abra uma issue com a tag `question` ou entre em contato no Slack do projeto.

---

**Lembre-se**: Código de qualidade é mais importante que velocidade. Invista tempo em fazer certo! 🚀
