## 📝 Descrição

<!-- Descreva brevemente o que este PR implementa/corrige -->

## 🎯 Tipo de Mudança

- [ ] 🐛 Bug fix (correção que não quebra funcionalidade existente)
- [ ] ✨ Nova feature (adição que não quebra funcionalidade existente)
- [ ] 💥 Breaking change (correção ou feature que causa quebra de compatibilidade)
- [ ] 📚 Documentação
- [ ] 🎨 Refatoração (sem mudança de comportamento)
- [ ] ⚡️ Performance
- [ ] ✅ Testes

## 🔗 Issue Relacionada

<!-- Link para a issue que este PR resolve, se aplicável -->

Closes #

## 🧪 Como Testar

<!-- Descreva os passos para testar as mudanças -->

1.
2.
3.

## ✅ Checklist de Qualidade

### Código

- [ ] Código segue os padrões do projeto (formatado com Prettier)
- [ ] Tipos TypeScript estão corretos (sem `any` desnecessários)
- [ ] Variáveis de ambiente validadas (se aplicável)
- [ ] DTOs/schemas Zod criados para validação (se aplicável)
- [ ] Comentários JSDoc adicionados em funções complexas
- [ ] Build compila sem erros (`npm run build`)

### Testes

- [ ] Testes unitários adicionados/atualizados
- [ ] Testes de integração adicionados (se aplicável)
- [ ] Todos os testes passam (`npm test`)
- [ ] Cobertura de testes mantida/melhorada

### Documentação

- [ ] README.md atualizado (se necessário)
- [ ] ARCHITECTURE.md atualizado (se mudança estrutural)
- [ ] Documentação de API atualizada (Swagger/OpenAPI)
- [ ] CHANGELOG.md atualizado

### Segurança

- [ ] Inputs do usuário validados
- [ ] Queries SQL parametrizadas (Prisma)
- [ ] Secrets não expostos no código
- [ ] Permissões/autorização verificadas

## 📸 Screenshots

<!-- Se aplicável, adicione screenshots das mudanças visuais -->

## 📊 Impacto

<!-- Descreva o impacto desta mudança -->

- **Performance**: <!-- Mudança significativa? -->
- **Compatibilidade**: <!-- Quebra algo existente? -->
- **Dependências**: <!-- Adiciona/remove dependências? -->

## 🤔 Observações Adicionais

<!-- Qualquer informação adicional relevante para os revisores -->

---

## 📋 Para Revisores

Por favor, verifique especialmente:

- [ ] Lógica de negócio está correta
- [ ] Não há vazamento de dados sensíveis
- [ ] Performance está adequada
- [ ] Código está legível e manutenível
