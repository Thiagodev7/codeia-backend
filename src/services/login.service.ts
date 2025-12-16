import { compare } from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

interface LoginInput {
  email: string
  passwordPlain: string
}

export class LoginService {
  async execute({ email, passwordPlain }: LoginInput) {
    // 1. Log de entrada
    logger.info({ email }, '🔐 [AUTH] Tentativa de login recebida')

    const user = await prisma.user.findUnique({ where: { email } })

    // 2. Erro de Usuário Inexistente
    if (!user) {
      logger.warn({ email }, '❌ [AUTH] Falha: E-mail não encontrado no banco')
      throw new Error('Este e-mail não possui cadastro.')
    }

    const isPasswordValid = await compare(passwordPlain, user.passwordHash)

    // 3. Erro de Senha
    if (!isPasswordValid) {
      logger.warn({ email }, '❌ [AUTH] Falha: Senha incorreta')
      throw new Error('Senha incorreta.')
    }

    // 4. Sucesso
    logger.info({ email, userId: user.id }, '✅ [AUTH] Login realizado com sucesso')

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        tenantId: user.tenantId
      }
    }
  }
}