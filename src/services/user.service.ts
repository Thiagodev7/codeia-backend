import { hash } from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { Errors } from '../lib/errors'

interface CreateUserInput {
  name: string
  email: string
  password: string
  phone?: string | null
  role?: string
}

interface UpdateUserInput {
  name?: string
  phone?: string | null
  role?: string
  password?: string
}

/**
 * Service de Gestão de Usuários
 * CRUD de membros da equipe dentro de um Tenant.
 */
export class UserService {
  
  async listByTenant(tenantId: string) {
    return prisma.user.findMany({
      where: { tenantId },
      select: { 
        id: true, name: true, email: true, phone: true, role: true, createdAt: true 
      }
    })
  }

  async create(tenantId: string, data: CreateUserInput) {
    const emailExists = await prisma.user.findUnique({ where: { email: data.email } })
    
    if (emailExists) {
      throw Errors.Conflict('Este e-mail já está em uso por outro usuário.')
    }

    const passwordHash = await hash(data.password, 6)

    return prisma.user.create({
      data: {
        tenantId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        passwordHash,
        role: data.role || 'AGENT'
      },
      select: { id: true, email: true }
    })
  }

  async update(tenantId: string, userId: string, data: UpdateUserInput) {
    // Validação de segurança: User pertence ao Tenant?
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw Errors.NotFound('Usuário não encontrado.')

    const updateData: any = { ...data }
    
    if (data.password) {
      updateData.passwordHash = await hash(data.password, 6)
      delete updateData.password
    }

    return prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, email: true, role: true }
    })
  }

  async delete(tenantId: string, userId: string) {
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw Errors.NotFound('Usuário não encontrado.')

    return prisma.user.delete({ where: { id: userId } })
  }
}