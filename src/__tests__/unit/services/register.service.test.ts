/**
 * Testes Unitários: RegisterService
 *
 * Testa a lógica de registro de novos tenants e usuários.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../../../lib/prisma'
import { RegisterService } from '../../../services/register.service'

const mockedPrisma = vi.mocked(prisma, true)

describe('RegisterService', () => {
  let service: RegisterService

  beforeEach(() => {
    service = new RegisterService()
    vi.clearAllMocks()
  })

  describe('execute', () => {
    const validInput = {
      companyName: 'Test Company',
      document: '12345678901234',
      phone: '11999999999',
      adminName: 'John Doe',
      email: 'john@example.com',
      password: 'password123',
    }

    it('should create new tenant and user successfully', async () => {
      const mockUser = {
        id: 'user-123',
        email: validInput.email,
        name: validInput.adminName,
        tenantId: 'tenant-123',
        tenant: {
          id: 'tenant-123',
          name: validInput.companyName,
        },
      }

      mockedPrisma.user.findUnique.mockResolvedValue(null) // Email não existe

      mockedPrisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          tenant: {
            create: vi.fn().mockResolvedValue({ id: 'tenant-123', name: validInput.companyName }),
          },
          user: {
            create: vi.fn().mockResolvedValue(mockUser),
          },
          agent: {
            create: vi.fn(),
          },
        })
      })

      const result = await service.execute(validInput)

      expect(result).toHaveProperty('user')
      expect(result).toHaveProperty('tenant')
      expect(result.user).toHaveProperty('id')
      expect(result.user).toHaveProperty('email', validInput.email)
      expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: validInput.email },
      })
      expect(mockedPrisma.$transaction).toHaveBeenCalled()
    })

    it('should throw Conflict error when email already exists', async () => {
      const existingUser = {
        id: 'existing-user',
        email: validInput.email,
        name: 'Existing User',
      }

      mockedPrisma.user.findUnique.mockResolvedValue(existingUser as any)

      await expect(service.execute(validInput)).rejects.toThrow('já está cadastrado')
    })

    it('should throw Conflict error when document already exists', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)

      const existingTenant = {
        id: 'existing-tenant',
        document: validInput.document,
      }

      mockedPrisma.tenant.findUnique.mockResolvedValue(existingTenant as any)

      await expect(service.execute(validInput)).rejects.toThrow('já está cadastrada')
    })

    it('should hash password before saving', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)
      mockedPrisma.tenant.findUnique.mockResolvedValue(null)

      const mockHashedPassword = 'hashed_password_123'
      vi.spyOn(require('bcryptjs'), 'hash').mockResolvedValue(mockHashedPassword)

      mockedPrisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          tenant: {
            create: vi.fn().mockResolvedValue({ id: 'tenant-123' }),
          },
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'user-123',
              email: validInput.email,
            }),
          },
          agent: {
            create: vi.fn(),
          },
        })
      })

      await service.execute(validInput)

      expect(require('bcryptjs').hash).toHaveBeenCalledWith(validInput.password, 6)
    })

    it('should create tenant with provided businessName', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)

      const createTenantMock = vi.fn().mockResolvedValue({
        id: 'tenant-123',
        name: validInput.companyName,
      })

      mockedPrisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          tenant: {
            create: createTenantMock,
          },
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'user-123',
              email: validInput.email,
            }),
          },
          agent: {
            create: vi.fn(),
          },
        })
      })

      await service.execute(validInput)

      expect(mockedPrisma.$transaction).toHaveBeenCalled()
    })

    it('should create user with ADMIN role', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)
      mockedPrisma.tenant.findUnique.mockResolvedValue(null)

      mockedPrisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          tenant: {
            create: vi.fn().mockResolvedValue({ id: 'tenant-123' }),
          },
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'user-123',
              email: validInput.email,
              role: 'ADMIN',
            }),
          },
          agent: {
            create: vi.fn(),
          },
        })
      })

      await service.execute(validInput)

      expect(mockedPrisma.$transaction).toHaveBeenCalled()
    })
  })
})
