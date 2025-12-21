import { prisma } from '../lib/prisma'
import { Errors } from '../lib/errors'

interface UpdateTenantInput {
  name?: string
  phone?: string | null
  document?: string
}

/**
 * Service de Gestão da Empresa (Tenant)
 * Manipula dados da própria conta/organização.
 */
export class TenantService {
  
  async getDetails(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: { users: true, customers: true, messages: true }
        }
      }
    })

    if (!tenant) throw Errors.NotFound('Empresa não encontrada.')
    return tenant
  }

  async update(tenantId: string, data: UpdateTenantInput) {
    return prisma.tenant.update({
      where: { id: tenantId },
      data
    })
  }

  async delete(tenantId: string) {
    // Soft Delete: Mantemos os dados por questões legais/segurança, apenas inativamos.
    return prisma.tenant.update({
      where: { id: tenantId },
      data: { isActive: false }
    })
  }
}