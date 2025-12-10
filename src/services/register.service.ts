import { hash } from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

interface RegisterInput {
  companyName: string
  document: string
  phone: string
  adminName: string
  email: string
  password: string
}

export class RegisterService {
  async execute(data: RegisterInput) {
    const userExists = await prisma.user.findUnique({ where: { email: data.email } })
    if (userExists) throw new Error('Email já cadastrado')

    const tenantExists = await prisma.tenant.findUnique({ where: { document: data.document } })
    if (tenantExists) throw new Error('Empresa já cadastrada')

    const passwordHash = await hash(data.password, 6)

    // Transação para garantir integridade
    const result = await prisma.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({
        data: { name: data.companyName, document: data.document }
      })

      const newUser = await tx.user.create({
        data: {
          name: data.adminName,
          email: data.email,
          phone: data.phone,
          passwordHash,
          tenantId: newTenant.id,
          role: 'ADMIN'
        }
      })
      
      // Cria um Agente Padrão para a empresa não começar vazia
      await tx.agent.create({
        data: {
          tenantId: newTenant.id,
          name: "Assistente Padrão",
          slug: "default",
          instructions: "Você é um assistente útil e amigável."
        }
      })

      return { tenant: newTenant, user: newUser }
    })

    logger.info(`Nova empresa registrada: ${result.tenant.name}`)
    return result
  }
}