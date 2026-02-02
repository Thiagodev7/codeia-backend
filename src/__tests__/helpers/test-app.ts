/**
 * Helper para Testes de Integração
 *
 * Configura o Fastify app para testes com mocks necessários.
 */
import jwt from '@fastify/jwt'
import Fastify, { FastifyInstance } from 'fastify'
import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// Criar App de Teste
// ---------------------------------------------------------------------------

/**
 * Cria uma instância do Fastify configurada para testes
 */
export const createTestApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false })

  // JWT plugin
  await app.register(jwt, { secret: 'test-secret' })

  return app
}

// ---------------------------------------------------------------------------
// Helpers de Autenticação
// ---------------------------------------------------------------------------

/**
 * Gera um token JWT válido para testes
 */
export const generateTestToken = (
  app: FastifyInstance,
  payload: { id: string; tenantId: string; email: string; role?: string }
): string => {
  return app.jwt.sign({
    id: payload.id,
    tenantId: payload.tenantId,
    email: payload.email,
    role: payload.role || 'ADMIN',
  })
}

/**
 * Cria headers com Authorization Bearer token
 */
export const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
})

// ---------------------------------------------------------------------------
// Mock Helpers
// ---------------------------------------------------------------------------

/**
 * Cria um mock do Prisma para testes de integração
 */
export const createIntegrationPrismaMock = () => ({
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  appointment: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  customer: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  message: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
})
