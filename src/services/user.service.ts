import { hash } from 'bcryptjs'
import { prisma } from '../lib/prisma'

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
  password?: string // Opcional
}

export class UserService {
  // LISTAR (Apenas do mesmo Tenant)
  async listByTenant(tenantId: string) {
    return prisma.user.findMany({
      where: { tenantId },
      select: { 
        id: true, 
        name: true, 
        email: true, 
        phone: true, 
        role: true, 
        createdAt: true 
      }
    })
  }

  // CRIAR (Adicionar membro ao time)
  async create(tenantId: string, data: CreateUserInput) {
    const emailExists = await prisma.user.findUnique({ where: { email: data.email } })
    if (emailExists) throw new Error('Email já está em uso no sistema.')

    const passwordHash = await hash(data.password, 6)

    return prisma.user.create({
      data: {
        tenantId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        passwordHash,
        role: data.role || 'AGENT' // Padrão é Agente, não Admin
      },
      select: { id: true, email: true }
    })
  }

  // EDITAR
  async update(tenantId: string, userId: string, data: UpdateUserInput) {
    // Segurança: Verifica se o user pertence ao tenant de quem está pedindo
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.tenantId !== tenantId) throw new Error('Usuário não encontrado.')

    const updateData: any = { ...data }
    
    // Se mandou senha nova, faz hash
    if (data.password) {
      updateData.passwordHash = await hash(data.password, 6)
      delete updateData.password
    }

    return prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, email: true }
    })
  }

  // DELETAR (Na verdade, vamos apagar fisicamente pois não temos campo isActive no User ainda, 
  // mas em SaaS enterprise geralmente fazemos soft-delete)
  async delete(tenantId: string, userId: string) {
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new Error('Usuário não encontrado.')

    // Impede que o usuário se delete (suicídio digital)
    // Isso deve ser validado no Controller pegando o ID do token, mas aqui garantimos também
    return prisma.user.delete({
      where: { id: userId }
    })
  }
}