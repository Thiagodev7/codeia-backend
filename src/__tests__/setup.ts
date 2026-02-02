/**
 * Setup Global de Testes
 *
 * Configura mocks globais para testes unitários e de integração.
 * Executado antes de cada arquivo de teste.
 */
import { afterEach, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock do Prisma Client
// ---------------------------------------------------------------------------

// Cria um mock factory para o Prisma
const createPrismaMock = () => ({
  $connect: vi.fn(),
  $disconnect: vi.fn(),
  $transaction: vi.fn((fn) => fn(prismaMock)),

  tenant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },

  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },

  customer: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },

  message: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },

  appointment: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },

  service: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },

  agent: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },

  whatsAppSession: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },

  tenantSettings: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  },

  businessHour: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
})

const prismaMock = createPrismaMock()

vi.mock('../lib/prisma', () => ({
  prisma: prismaMock,
}))

// ---------------------------------------------------------------------------
// Mock do Redis
// ---------------------------------------------------------------------------

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  hget: vi.fn(),
  hset: vi.fn(),
  hgetall: vi.fn(),
  hdel: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn(),
  on: vi.fn(),
  duplicate: vi.fn(() => redisMock),
}

vi.mock('../lib/redis', () => ({
  redis: redisMock,
  subscriber: redisMock,
}))

// ---------------------------------------------------------------------------
// Mock das Filas
// ---------------------------------------------------------------------------

const queueMock = {
  add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
  getJob: vi.fn(),
  getJobs: vi.fn(),
  close: vi.fn(),
}

vi.mock('../lib/queues', () => ({
  whatsappQueue: queueMock,
  WHATSAPP_STATUS_CHANNEL: 'whatsapp:status',
  WHATSAPP_SESSIONS_HASH: 'whatsapp:sessions',
}))

// ---------------------------------------------------------------------------
// Mock do Logger (silencia logs durante testes)
// ---------------------------------------------------------------------------

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Hooks Globais
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Exports para uso nos testes
// ---------------------------------------------------------------------------

export { prismaMock, queueMock, redisMock }
