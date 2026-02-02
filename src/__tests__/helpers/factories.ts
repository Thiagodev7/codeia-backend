/**
 * Factories de Dados para Testes
 *
 * Utiliza @faker-js/faker para gerar dados realistas e consistentes.
 */
import { faker } from '@faker-js/faker/locale/pt_BR'

// ---------------------------------------------------------------------------
// Base Types (espelham os models do Prisma)
// ---------------------------------------------------------------------------

export interface MockTenant {
  id: string
  name: string
  document: string
  plan: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface MockUser {
  id: string
  tenantId: string
  name: string
  email: string
  phone: string | null
  passwordHash: string
  role: string
  createdAt: Date
  updatedAt: Date
}

export interface MockCustomer {
  id: string
  tenantId: string
  phone: string
  name: string | null
  createdAt: Date
}

export interface MockAppointment {
  id: string
  tenantId: string
  customerId: string
  serviceId: string | null
  title: string
  description: string | null
  startTime: Date
  endTime: Date
  status: string
  reminderSent: boolean
}

export interface MockService {
  id: string
  tenantId: string
  name: string
  description: string | null
  price: number
  duration: number
  isActive: boolean
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export const createMockTenant = (overrides: Partial<MockTenant> = {}): MockTenant => ({
  id: faker.string.uuid(),
  name: faker.company.name(),
  document: faker.string.numeric(14), // CNPJ
  plan: 'BASIC',
  isActive: true,
  createdAt: faker.date.past(),
  updatedAt: new Date(),
  ...overrides,
})

export const createMockUser = (overrides: Partial<MockUser> = {}): MockUser => ({
  id: faker.string.uuid(),
  tenantId: faker.string.uuid(),
  name: faker.person.fullName(),
  email: faker.internet.email().toLowerCase(),
  phone: faker.string.numeric(11),
  passwordHash: '$2a$10$hashedpassword', // bcrypt hash fake
  role: 'ADMIN',
  createdAt: faker.date.past(),
  updatedAt: new Date(),
  ...overrides,
})

export const createMockCustomer = (overrides: Partial<MockCustomer> = {}): MockCustomer => ({
  id: faker.string.uuid(),
  tenantId: faker.string.uuid(),
  phone: faker.string.numeric(11),
  name: faker.person.fullName(),
  createdAt: faker.date.past(),
  ...overrides,
})

export const createMockService = (overrides: Partial<MockService> = {}): MockService => ({
  id: faker.string.uuid(),
  tenantId: faker.string.uuid(),
  name: faker.commerce.productName(),
  description: faker.commerce.productDescription(),
  price: parseFloat(faker.commerce.price({ min: 50, max: 500 })),
  duration: faker.helpers.arrayElement([30, 45, 60, 90, 120]),
  isActive: true,
  createdAt: faker.date.past(),
  ...overrides,
})

export const createMockAppointment = (
  overrides: Partial<MockAppointment> = {}
): MockAppointment => {
  const startTime = faker.date.future()
  const duration = overrides.serviceId ? 60 : faker.helpers.arrayElement([30, 60, 90])
  const endTime = new Date(startTime.getTime() + duration * 60000)

  return {
    id: faker.string.uuid(),
    tenantId: faker.string.uuid(),
    customerId: faker.string.uuid(),
    serviceId: null,
    title: faker.commerce.productName(),
    description: faker.lorem.sentence(),
    startTime,
    endTime,
    status: 'SCHEDULED',
    reminderSent: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cria múltiplos itens usando a factory fornecida
 */
export const createMany = <T>(
  factory: (overrides?: Partial<T>) => T,
  count: number,
  overrides?: Partial<T>
): T[] => {
  return Array.from({ length: count }, () => factory(overrides))
}

/**
 * Gera um token JWT fake para testes
 */
export const createMockJwtPayload = (tenantId: string, userId: string, role = 'ADMIN') => ({
  sub: userId,
  tenantId,
  role,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 86400, // 24h
})
