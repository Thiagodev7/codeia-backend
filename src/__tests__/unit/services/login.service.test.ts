/**
 * Testes Unitários: LoginService
 * 
 * Testa a autenticação de usuários.
 */
import * as bcrypt from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../../../lib/prisma'
import { LoginService } from '../../../services/login.service'
import { createMockUser } from '../../helpers/factories'

// Mock bcrypt
vi.mock('bcryptjs', () => ({
  compare: vi.fn()
}))

const mockedPrisma = vi.mocked(prisma, true)
const mockedBcrypt = vi.mocked(bcrypt, true)

describe('LoginService', () => {
  let service: LoginService

  beforeEach(() => {
    service = new LoginService()
    vi.clearAllMocks()
  })

  describe('execute', () => {
    const validCredentials = {
      email: 'test@example.com',
      passwordPlain: 'password123'
    }

    it('should login successfully with valid credentials', async () => {
      const mockUser = createMockUser({
        email: validCredentials.email,
        passwordHash: 'hashedPassword'
      })

      mockedPrisma.user.findUnique.mockResolvedValue(mockUser as any)
      mockedBcrypt.compare.mockResolvedValue(true as never)

      const result = await service.execute(validCredentials)

      expect(result.user).toBeDefined()
      expect(result.user.email).toBe(validCredentials.email)
      expect(result.user.id).toBe(mockUser.id)
      expect(result.user.tenantId).toBe(mockUser.tenantId)
      
      // Não deve retornar o hash da senha
      expect((result.user as any).passwordHash).toBeUndefined()
    })

    it('should throw Unauthorized for non-existent email', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)

      await expect(service.execute(validCredentials))
        .rejects.toThrow('Credenciais inválidas')
    })

    it('should throw Unauthorized for wrong password', async () => {
      const mockUser = createMockUser({ email: validCredentials.email })

      mockedPrisma.user.findUnique.mockResolvedValue(mockUser as any)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      await expect(service.execute(validCredentials))
        .rejects.toThrow('Credenciais inválidas')
    })

    it('should use generic error message to prevent user enumeration', async () => {
      // Mesmo erro para email não encontrado e senha errada
      mockedPrisma.user.findUnique.mockResolvedValue(null)

      try {
        await service.execute(validCredentials)
      } catch (error: any) {
        expect(error.message).toBe('Credenciais inválidas.')
        expect(error.statusCode).toBe(401)
      }

      // Reset e testar senha errada
      const mockUser = createMockUser({ email: validCredentials.email })
      mockedPrisma.user.findUnique.mockResolvedValue(mockUser as any)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      try {
        await service.execute(validCredentials)
      } catch (error: any) {
        // Mesma mensagem genérica
        expect(error.message).toBe('Credenciais inválidas.')
        expect(error.statusCode).toBe(401)
      }
    })

    it('should return correct user fields', async () => {
      const mockUser = createMockUser({
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '11999999999',
        role: 'ADMIN',
        tenantId: 'tenant-456'
      })

      mockedPrisma.user.findUnique.mockResolvedValue(mockUser as any)
      mockedBcrypt.compare.mockResolvedValue(true as never)

      const result = await service.execute({
        email: mockUser.email,
        passwordPlain: 'any'
      })

      expect(result.user).toEqual({
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '11999999999',
        role: 'ADMIN',
        tenantId: 'tenant-456'
      })
    })
  })
})
