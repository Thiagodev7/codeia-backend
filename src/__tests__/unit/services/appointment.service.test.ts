/**
 * Testes Unitários: AppointmentService
 * 
 * Testa a lógica de criação, cancelamento e reagendamento de appointments.
 */
import { addMinutes, subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../../../lib/prisma'
import { AppointmentService } from '../../../services/appointment.service'
import { createMockAppointment, createMockService } from '../../helpers/factories'

// Type helper para mocks
const mockedPrisma = vi.mocked(prisma, true)

describe('AppointmentService', () => {
  let service: AppointmentService
  const tenantId = 'tenant-123'
  const customerId = 'customer-456'

  beforeEach(() => {
    service = new AppointmentService()
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // listByTenant
  // ---------------------------------------------------------------------------
  describe('listByTenant', () => {
    it('should return all appointments for tenant', async () => {
      const mockAppointments = [
        createMockAppointment({ tenantId }),
        createMockAppointment({ tenantId }),
      ]
      mockedPrisma.appointment.findMany.mockResolvedValue(mockAppointments as any)

      const result = await service.listByTenant(tenantId)

      expect(result).toHaveLength(2)
      expect(mockedPrisma.appointment.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          service: { select: { id: true, name: true, price: true } }
        },
        orderBy: { startTime: 'desc' }
      })
    })
  })

  // ---------------------------------------------------------------------------
  // listUpcoming
  // ---------------------------------------------------------------------------
  describe('listUpcoming', () => {
    it('should return only scheduled appointments for customer', async () => {
      const mockAppointments = [createMockAppointment({ tenantId, customerId, status: 'SCHEDULED' })]
      mockedPrisma.appointment.findMany.mockResolvedValue(mockAppointments as any)

      const result = await service.listUpcoming(tenantId, customerId)

      expect(result).toHaveLength(1)
      expect(mockedPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            customerId,
            status: 'SCHEDULED',
          }),
          orderBy: { startTime: 'asc' },
          include: { service: true }
        })
      )
    })
  })

  // ---------------------------------------------------------------------------
  // cancelAppointment
  // ---------------------------------------------------------------------------
  describe('cancelAppointment', () => {
    it('should cancel existing appointment', async () => {
      const appointment = createMockAppointment({ 
        id: 'apt-123', 
        tenantId, 
        customerId, 
        status: 'SCHEDULED' 
      })
      mockedPrisma.appointment.findFirst.mockResolvedValue(appointment as any)
      mockedPrisma.appointment.update.mockResolvedValue({ ...appointment, status: 'CANCELED' } as any)

      const result = await service.cancelAppointment(tenantId, customerId, 'apt-123')

      expect(result.status).toBe('CANCELED')
      expect(mockedPrisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'apt-123' },
        data: { status: 'CANCELED' }
      })
    })

    it('should throw NotFound if appointment does not exist', async () => {
      mockedPrisma.appointment.findFirst.mockResolvedValue(null)

      await expect(service.cancelAppointment(tenantId, customerId, 'non-existent'))
        .rejects.toThrow('Agendamento não encontrado')
    })

    it('should throw BadRequest if already canceled', async () => {
      const canceledAppointment = createMockAppointment({ 
        tenantId, 
        customerId, 
        status: 'CANCELED' 
      })
      mockedPrisma.appointment.findFirst.mockResolvedValue(canceledAppointment as any)

      await expect(service.cancelAppointment(tenantId, customerId, 'apt-123'))
        .rejects.toThrow('já foi cancelado')
    })
  })

  // ---------------------------------------------------------------------------
  // createAppointment
  // ---------------------------------------------------------------------------
  describe('createAppointment', () => {
    const futureDate = addMinutes(new Date(), 60) // 1 hora no futuro

    it('should create appointment with valid data', async () => {
      const mockCreatedAppointment = createMockAppointment({
        tenantId,
        customerId,
        startTime: futureDate,
        status: 'SCHEDULED'
      })

      // Mock transaction
      mockedPrisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          service: { findFirst: vi.fn().mockResolvedValue(null) },
          appointment: {
            findFirst: vi.fn().mockResolvedValue(null), // Sem conflito
            create: vi.fn().mockResolvedValue(mockCreatedAppointment)
          },
          customer: { update: vi.fn() }
        })
      })

      const result = await service.createAppointment({
        tenantId,
        customerId,
        title: 'Consulta',
        startTime: futureDate
      })

      expect(result).toBeDefined()
      expect(mockedPrisma.$transaction).toHaveBeenCalled()
    })

    it('should throw error for past dates', async () => {
      const pastDate = subDays(new Date(), 1) // Ontem

      await expect(service.createAppointment({
        tenantId,
        customerId,
        title: 'Consulta',
        startTime: pastDate
      })).rejects.toThrow('passado')
    })

    it('should throw Conflict when time slot is occupied', async () => {
      const futureDate = addMinutes(new Date(), 60)
      const existingAppointment = createMockAppointment({ tenantId })

      mockedPrisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          service: { findFirst: vi.fn().mockResolvedValue(null) },
          appointment: {
            findFirst: vi.fn().mockResolvedValue(existingAppointment), // Conflito!
            create: vi.fn()
          },
          customer: { update: vi.fn() }
        })
      })

      await expect(service.createAppointment({
        tenantId,
        customerId,
        title: 'Consulta',
        startTime: futureDate
      })).rejects.toThrow('indisponível')
    })

    it('should use service duration when serviceId is provided', async () => {
      const futureDate = addMinutes(new Date(), 60)
      const mockService = createMockService({ id: 'svc-123', duration: 45 })
      const mockCreatedAppointment = createMockAppointment({ tenantId, customerId })

      mockedPrisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          service: { findFirst: vi.fn().mockResolvedValue(mockService) },
          appointment: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(mockCreatedAppointment)
          },
          customer: { update: vi.fn() }
        })
      })

      await service.createAppointment({
        tenantId,
        customerId,
        serviceId: 'svc-123',
        title: 'Serviço',
        startTime: futureDate
      })

      expect(mockedPrisma.$transaction).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // rescheduleAppointment
  // ---------------------------------------------------------------------------
  describe('rescheduleAppointment', () => {
    it('should throw error for past dates', async () => {
      const pastDate = subDays(new Date(), 1)

      await expect(service.rescheduleAppointment(tenantId, 'apt-123', pastDate))
        .rejects.toThrow('passado')
    })

    it('should throw NotFound if appointment does not exist', async () => {
      const futureDate = addMinutes(new Date(), 120)
      
      mockedPrisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          appointment: {
            findFirst: vi.fn().mockResolvedValue(null), // Não existe
            update: vi.fn()
          }
        })
      })

      await expect(service.rescheduleAppointment(tenantId, 'non-existent', futureDate))
        .rejects.toThrow('não encontrado')
    })
  })
})
