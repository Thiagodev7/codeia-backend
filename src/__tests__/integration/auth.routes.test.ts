/**
 * Testes de Integração: Auth Routes
 * 
 * Testa o fluxo completo de autenticação via HTTP.
 */
import jwt from '@fastify/jwt'
import Fastify, { FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authRoutes } from '../../routes/auth.routes'

// Mock do Prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn()
    }
  }
}))

// Mock do bcrypt
vi.mock('bcryptjs', () => ({
  compare: vi.fn()
}))

import * as bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'
import { createMockUser } from '../helpers/factories'

const mockedPrisma = vi.mocked(prisma, true)
const mockedBcrypt = vi.mocked(bcrypt, true)

describe('Auth Routes - Integration', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    // Criar app Fastify para testes
    app = Fastify({ logger: false })
    
    // Configurar Zod validators (obrigatório para fastify-type-provider-zod)
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    
    // Registrar plugins necessários
    await app.register(jwt, { secret: 'test-jwt-secret' })
    
    // Registrar routes com prefixo /auth
    await app.register(authRoutes, { prefix: '/auth' })
    
    await app.ready()
    
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await app.close()
  })

  // ---------------------------------------------------------------------------
  // POST /auth/login
  // ---------------------------------------------------------------------------
  describe('POST /auth/login', () => {
    const validCredentials = {
      email: 'test@example.com',
      password: 'validPassword123'
    }

    it('should return 200 and token for valid credentials', async () => {
      const mockUser = createMockUser({
        email: validCredentials.email,
        passwordHash: 'hashedPassword'
      })

      mockedPrisma.user.findUnique.mockResolvedValue(mockUser as any)
      mockedBcrypt.compare.mockResolvedValue(true as never)

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: validCredentials
      })

      expect(response.statusCode).toBe(200)
      
      const body = JSON.parse(response.body)
      expect(body.token).toBeDefined()
      expect(body.user).toBeDefined()
      expect(body.user.email).toBe(validCredentials.email)
    })

    it('should return 401 for invalid email', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: validCredentials
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return 401 for wrong password', async () => {
      const mockUser = createMockUser({ email: validCredentials.email })
      
      mockedPrisma.user.findUnique.mockResolvedValue(mockUser as any)
      mockedBcrypt.compare.mockResolvedValue(false as never)

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: validCredentials
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return 400 for missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { password: 'somePassword' }
      })

      expect(response.statusCode).toBe(400)
    })

    it('should return 400 for invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'not-an-email', password: 'validPassword' }
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
