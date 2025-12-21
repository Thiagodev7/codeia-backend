import { prisma } from '../lib/prisma'

interface CreateServiceInput {
  name: string
  duration: number
  price: number
  description?: string
}

/**
 * Service de Catálogo de Serviços
 * Gerencia os serviços (ex: Corte, Manicure) que a IA pode agendar.
 */
export class ServiceService {
  
  async list(tenantId: string) {
    return prisma.service.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' }
    })
  }

  async create(tenantId: string, data: CreateServiceInput) {
    return prisma.service.create({
      data: {
        tenantId,
        ...data
      }
    })
  }

  async delete(tenantId: string, id: string) {
    // Soft Delete para preservar histórico de agendamentos passados
    return prisma.service.updateMany({
      where: { id, tenantId },
      data: { isActive: false }
    })
  }
}