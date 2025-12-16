import { compare } from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

interface LoginInput {
  email: string
  passwordPlain: string
}

export class LoginService {
  async execute({ email, passwordPlain }: LoginInput) {
    // Log para saber que alguém tentou
    logger.info({ email }, '🔐 [AUTH] Tentativa de login recebida')

    const user = await prisma.user.findUnique({ where: { email } })

    if (!user) {
      // Log específico para você ver no terminal
      logger.warn({ email }, '❌ [AUTH] Falha: Usuário não encontrado no banco')
      throw new Error('Este e-mail não está cadastrado.')
    }

    const isPasswordValid = await compare(passwordPlain, user.passwordHash)

    if (!isPasswordValid) {
      // Log específico de senha errada
      logger.warn({ email }, '❌ [AUTH] Falha: Senha incorreta')
      throw new Error('Senha incorreta. Tente novamente.')
    }

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