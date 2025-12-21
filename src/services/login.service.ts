import { compare } from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { Errors } from '../lib/errors'

interface LoginInput {
  email: string
  passwordPlain: string
}

/**
 * Service de Login
 * Autentica credenciais e retorna dados do usuário para geração do token.
 */
export class LoginService {
  async execute({ email, passwordPlain }: LoginInput) {
    logger.info({ email }, '🔐 [AUTH] Tentativa de login')

    const user = await prisma.user.findUnique({ where: { email } })

    // Segurança: Mensagens genéricas para evitar enumeração de usuários
    if (!user) {
      logger.warn({ email }, '❌ [AUTH] E-mail não encontrado')
      throw Errors.Unauthorized('Credenciais inválidas.')
    }

    const isPasswordValid = await compare(passwordPlain, user.passwordHash)

    if (!isPasswordValid) {
      logger.warn({ email }, '❌ [AUTH] Senha incorreta')
      throw Errors.Unauthorized('Credenciais inválidas.')
    }

    logger.info({ userId: user.id, tenantId: user.tenantId }, '✅ [AUTH] Login realizado')

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