import { prisma } from '../lib/prisma'

interface UpdateTenantInput {
  name?: string
  phone?: string | null
  document?: string
}

export class TenantService {
  // BUSCAR DADOS (Dashboard)
  async getDetails(tenantId: string) {
    return prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: { users: true, customers: true, messages: true }
        }
      }
    })
  }

  // ATUALIZAR
  async update(tenantId: string, data: UpdateTenantInput) {
    return prisma.tenant.update({
      where: { id: tenantId },
      data
    })
  }

  // DELETAR CONTA (Perigo!)
  async delete(tenantId: string) {
    // Em produção, isso aqui desencadearia uma cascata de deleções.
    // O Prisma faz isso se configurado com onDelete: Cascade no Schema.
    // Por segurança, vamos apenas marcar como inativo.
    return prisma.tenant.update({
      where: { id: tenantId },
      data: { isActive: false }
    })
  }
}