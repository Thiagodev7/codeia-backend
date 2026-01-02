import { prisma } from '../lib/prisma'

// Interfaces de Entrada
interface CreateServiceInput {
  name: string
  description?: string
  price: number
  duration: number
}

interface UpdateServiceInput {
  name?: string
  description?: string
  price?: number
  duration?: number
  isActive?: boolean
}

/**
 * ServiceService
 * Responsável por gerenciar o catálogo de serviços que a empresa oferece.
 */
export class ServiceService {
  
  /**
   * Lista todos os serviços ativos e inativos de uma empresa
   */
  async list(tenantId: string) {
    return prisma.service.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' }
    })
  }

  /**
   * Cria um novo serviço
   */
  async create(tenantId: string, data: CreateServiceInput) {
    return prisma.service.create({
      data: {
        tenantId,
        ...data
      }
    })
  }

  /**
   * Atualiza um serviço existente
   * Verifica se o serviço pertence à empresa antes de atualizar.
   */
  async update(tenantId: string, serviceId: string, data: UpdateServiceInput) {
    const service = await prisma.service.findFirst({
      where: { id: serviceId, tenantId }
    })

    if (!service) {
      throw new Error('Serviço não encontrado ou acesso negado.')
    }

    return prisma.service.update({
      where: { id: serviceId },
      data
    })
  }

  /**
   * Remove (deleta) um serviço
   */
  async delete(tenantId: string, serviceId: string) {
    const service = await prisma.service.findFirst({
      where: { id: serviceId, tenantId }
    })

    if (!service) {
      throw new Error('Serviço não encontrado ou acesso negado.')
    }

    return prisma.service.delete({
      where: { id: serviceId }
    })
  }
}