/**
 * Testes Unitários: UserService
 *
 * Testa a lógica de CRUD de usuários dentro de um tenant.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../../../lib/prisma'
import { UserService } from '../../../services/user.service'
import { createMockUser } from '../../helpers/factories'

const mockedPrisma = vi.mocked(prisma, true)

describe('UserService', () => {
  let service: UserService
  const tenantId = 'tenant-123'
  const userId = 'user-123'

  beforeEach(() => {
    service = new UserService()
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // listByTenant
  // ---------------------------------------------------------------------------
  describe('listByTenant', () => {
    it('should return all users from tenant', async () => {
      const mockUsers = [
        createMockUser({ tenantId, role: 'ADMIN' }),
        createMockUser({ tenantId, role: 'AGENT' }),
      ]

      mockedPrisma.user.findMany.mockResolvedValue(mockUsers as any)

      const result = await service.listByTenant(tenantId)

      expect(result).toHaveLength(2)
      expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
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
    })
  })

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    const createInput = {
      name: 'New User',
      email: 'newuser@example.com',
      password: 'password123',
      phone: '11999999999',
      role: 'AGENT',
    }

    it('should create user successfully with valid data', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null) // Email não existe

      const mockCreatedUser = createMockUser({
        ...createInput,
        tenantId,
      })

      mockedPrisma.user.create.mockResolvedValue(mockCreatedUser as any)

      const result = await service.create(tenantId, createInput)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email', createInput.email)
      expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: createInput.email },
      })
    })

    it('should throw Conflict when email already exists', async () => {
      const existingUser = createMockUser({ email: createInput.email })
      mockedPrisma.user.findUnique.mockResolvedValue(existingUser as any)

      await expect(service.create(tenantId, createInput)).rejects.toThrow('já está em uso')
    })

    it('should hash password before saving', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)

      const mockHashedPassword = 'hashed_password_123'
      vi.spyOn(require('bcryptjs'), 'hash').mockResolvedValue(mockHashedPassword)

      mockedPrisma.user.create.mockResolvedValue({
        id: 'user-123',
        email: createInput.email,
      } as any)

      await service.create(tenantId, createInput)

      expect(require('bcryptjs').hash).toHaveBeenCalledWith(createInput.password, 6)
    })

    it('should use AGENT as default role when not provided', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)

      const inputWithoutRole = { ...createInput }
      delete (inputWithoutRole as any).role

      mockedPrisma.user.create.mockResolvedValue({
        id: 'user-123',
        role: 'AGENT',
      } as any)

      await service.create(tenantId, inputWithoutRole)

      expect(mockedPrisma.user.create).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    const updateInput = {
      name: 'Updated Name',
      phone: '11888888888',
    }

    it('should update user successfully', async () => {
      const existingUser = createMockUser({ id: userId, tenantId })
      mockedPrisma.user.findFirst.mockResolvedValue(existingUser as any)

      const updatedUser = { ...existingUser, ...updateInput }
      mockedPrisma.user.update.mockResolvedValue(updatedUser as any)

      const result = await service.update(tenantId, userId, updateInput)

      expect(result).toHaveProperty('name', updateInput.name)
      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: updateInput,
        select: { id: true, name: true, email: true, role: true },
      })
    })

    it('should throw NotFound when user does not exist', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(null)

      await expect(service.update(tenantId, 'non-existent', updateInput)).rejects.toThrow(
        'não encontrado'
      )
    })

    it('should validate that user belongs to tenant', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(null)

      await expect(service.update(tenantId, userId, updateInput)).rejects.toThrow('não encontrado')

      expect(mockedPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: userId, tenantId },
      })
    })

    it('should hash password when updating password', async () => {
      const existingUser = createMockUser({ id: userId, tenantId })
      mockedPrisma.user.findFirst.mockResolvedValue(existingUser as any)

      const mockHashedPassword = 'new_hashed_password'
      vi.spyOn(require('bcryptjs'), 'hash').mockResolvedValue(mockHashedPassword)

      mockedPrisma.user.update.mockResolvedValue({} as any)

      await service.update(tenantId, userId, { password: 'newpassword123' })

      expect(require('bcryptjs').hash).toHaveBeenCalledWith('newpassword123', 6)
    })
  })

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('should delete user successfully', async () => {
      const existingUser = createMockUser({ id: userId, tenantId })
      mockedPrisma.user.findFirst.mockResolvedValue(existingUser as any)
      mockedPrisma.user.delete.mockResolvedValue(existingUser as any)

      await service.delete(tenantId, userId)

      expect(mockedPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: userId },
      })
    })

    it('should throw NotFound when user does not exist', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(null)

      await expect(service.delete(tenantId, 'non-existent')).rejects.toThrow('não encontrado')
    })

    it('should validate that user belongs to tenant before deleting', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(null)

      await expect(service.delete(tenantId, userId)).rejects.toThrow('não encontrado')

      expect(mockedPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: userId, tenantId },
      })
    })
  })
})
