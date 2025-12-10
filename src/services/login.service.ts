import { compare } from 'bcryptjs'
import { prisma } from '../lib/prisma'

interface LoginInput {
  email: string
  passwordPlain: string
}

export class LoginService {
  async execute({ email, passwordPlain }: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || !(await compare(passwordPlain, user.passwordHash))) {
      throw new Error('Credenciais inválidas')
    }

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