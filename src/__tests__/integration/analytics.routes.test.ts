/**
 * Testes de Integração: Analytics Routes
 *
 * Testa o endpoint de dashboard analytics.
 */
import jwt from '@fastify/jwt'
import Fastify, { FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyticsRoutes } from '../../routes/analytics.routes'

// Mock do Prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    customer: { count: vi.fn() },
    message: { count: vi.fn() },
    appointment: { count: vi.fn() },
    user: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '../../lib/prisma'

const mockedPrisma = vi.mocked(prisma, true)

describe('Analytics Routes - Integration', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    // Criar app Fastify para testes
    app = Fastify({ logger: false })

    // Configurar Zod validators
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)

    // Registrar plugins
    await app.register(jwt, { secret: 'test-jwt-secret' })
    await app.register(analyticsRoutes)

    await app.ready()

    vi.clearAllMocks()
  })

  afterEach(async () => {
    await app.close()
  })

  // ---------------------------------------------------------------------------
  // GET /analytics/dashboard
  // ---------------------------------------------------------------------------
  describe('GET /analytics/dashboard', () => {
    it('should return 200 and formatted data', async () => {
      // Setup Mocks
      mockedPrisma.customer.count.mockResolvedValue(10)
      mockedPrisma.message.count.mockResolvedValue(200)
      mockedPrisma.appointment.count.mockResolvedValue(50)
      mockedPrisma.user.count.mockResolvedValue(3)

      // Mock Raw Queries (retorno deve ser array de objetos)
      mockedPrisma.$queryRaw.mockResolvedValue([
        { date: '01/02', count: BigInt(5) },
        { date: '02/02', count: BigInt(8) },
      ] as any)

      // Criar Token Falso
      const token = app.jwt.sign({
        sub: 'user-123',
        tenantId: 'tenant-123',
        role: 'ADMIN',
      })

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/dashboard',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.body)

      // Verificar Stats
      expect(body.stats).toEqual({
        customers: 10,
        messages: 200,
        appointments: 50,
        users: 3,
      })

      // Verificar Charts
      expect(body.charts.appointments).toHaveLength(2)
      expect(body.charts.appointments[0]).toEqual({ name: '01/02', value: 5 })
      expect(body.charts.messages).toHaveLength(2)
    })

    it('should return 401 if missing token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/analytics/dashboard',
      })

      expect(response.statusCode).toBe(401)
    })
  })
})
