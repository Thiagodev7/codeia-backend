import { hash } from 'bcryptjs'
import { Errors } from '../lib/errors'
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
  password?: string
}

/**
 * Service de Gestão de Usuários
 *
 * Responsável pelo CRUD de membros da equipe dentro de um Tenant.
 * Todos os métodos respeitam o isolamento multi-tenant.
 *
 * @remarks
 * - Senhas são automaticamente hasheadas com bcrypt
 * - Role padrão é 'AGENT' se não especificado
 * - Emails devem ser únicos em toda a plataforma
 *
 * @example
 * ```typescript
 * const userService = new UserService()
 * const users = await userService.listByTenant('tenant-123')
 * ```
 */
export class UserService {
  /**
   * Lista todos os usuários de um tenant
   *
   * @param tenantId - ID do tenant
   * @returns Array de usuários com informações básicas (sem senha)
   *
   * @example
   * ```typescript
   * const users = await userService.listByTenant('tenant-123')
   * // Retorna: [{ id, name, email, phone, role, createdAt }]
   * ```
   */
  async listByTenant(tenantId: string) {
    return prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    })
  }

  /**
   * Cria um novo usuário no tenant
   *
   * @param tenantId - ID do tenant
   * @param data - Dados do novo usuário
   * @returns Usuário criado com id e email
   * @throws {AppError} Conflict se email já existir
   *
   * @example
   * ```typescript
   * const user = await userService.create('tenant-123', {
   *   name: 'João Silva',
   *   email: 'joao@example.com',
   *   password: 'senha123',
   *   role: 'AGENT'
   * })
   * ```
   */
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
        role: data.role || 'AGENT',
      },
      select: { id: true, email: true },
    })
  }

  /**
   * Atualiza dados de um usuário
   *
   * @param tenantId - ID do tenant
   * @param userId - ID do usuário a atualizar
   * @param data - Dados a atualizar (name, phone, role, password)
   * @returns Usuário atualizado
   * @throws {AppError} NotFound se usuário não existir ou não pertencer ao tenant
   *
   * @remarks
   * - Valida que o usuário pertence ao tenant (segurança multi-tenant)
   * - Se password for fornecido, será automaticamente hasheado
   *
   * @example
   * ```typescript
   * const updated = await userService.update('tenant-123', 'user-456', {
   *   name: 'João Silva Atualizado',
   *   role: 'ADMIN'
   * })
   * ```
   */
  async update(tenantId: string, userId: string, data: UpdateUserInput) {
    // Validação de segurança: User pertence ao Tenant?
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw Errors.NotFound('Usuário não encontrado.')

    const updateData: Partial<UpdateUserInput & { passwordHash?: string }> = { ...data }

    if (data.password) {
      updateData.passwordHash = await hash(data.password, 6)
      delete updateData.password
    }

    return prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, email: true, role: true },
    })
  }

  /**
   * Remove um usuário do sistema
   *
   * @param tenantId - ID do tenant
   * @param userId - ID do usuário a remover
   * @throws {AppError} NotFound se usuário não existir ou não pertencer ao tenant
   *
   * @remarks
   * - Valida que o usuário pertence ao tenant antes de deletar
   * - Operação irreversível
   *
   * @example
   * ```typescript
   * await userService.delete('tenant-123', 'user-456')
   * ```
   */
  async delete(tenantId: string, userId: string) {
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw Errors.NotFound('Usuário não encontrado.')

    return prisma.user.delete({ where: { id: userId } })
  }
}
