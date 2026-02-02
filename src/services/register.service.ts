import { hash } from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { Errors } from '../lib/errors'

interface RegisterInput {
  companyName: string
  document: string
  phone: string
  adminName: string
  email: string
  password: string
}

/**
 * Service de Registro (Onboarding)
 * Responsável por criar a estrutura inicial de um novo Tenant (Empresa).
 */
export class RegisterService {
  async execute(data: RegisterInput) {
    // 1. Validações de Unicidade
    const userExists = await prisma.user.findUnique({ where: { email: data.email } })
    if (userExists) {
      throw Errors.Conflict('Este e-mail já está cadastrado.')
    }

    const tenantExists = await prisma.tenant.findUnique({ where: { document: data.document } })
    if (tenantExists) {
      throw Errors.Conflict('Esta empresa (CPF/CNPJ) já está cadastrada.')
    }

    const passwordHash = await hash(data.password, 6)

    // 2. Transação Atômica: Ou cria tudo (Empresa + Admin + Agente), ou nada.
    const result = await prisma.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({
        data: { name: data.companyName, document: data.document },
      })

      const newUser = await tx.user.create({
        data: {
          name: data.adminName,
          email: data.email,
          phone: data.phone,
          passwordHash,
          tenantId: newTenant.id,
          role: 'ADMIN',
        },
      })

      // Criação do Agente Padrão (Bootstrap da IA)
      await tx.agent.create({
        data: {
          tenantId: newTenant.id,
          name: 'Assistente Principal',
          slug: 'atendente',
          instructions: 'Você é um assistente útil e amigável da empresa ' + data.companyName + '.',
        },
      })

      return { tenant: newTenant, user: newUser }
    })

    logger.info({ tenantId: result.tenant.id }, `🎉 Nova empresa registrada: ${result.tenant.name}`)
    return result
  }
}
