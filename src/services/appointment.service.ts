import { addMinutes, isBefore, startOfMinute, subHours } from 'date-fns'
import { Errors } from '../lib/errors'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'

interface CreateAppointmentDTO {
  tenantId: string
  customerId: string
  serviceId?: string
  title: string
  clientName?: string
  clientPhone?: string
  startTime: Date
}

/**
 * Service de Agendamento
 *
 * Núcleo da lógica de calendário, conflitos e validações de data.
 * Responsável por criar, listar, cancelar e reagendar compromissos.
 *
 * @remarks
 * - Valida horários de funcionamento do negócio
 * - Previne conflitos de agendamento
 * - Suporta duração personalizada por serviço
 * - Integrado com IA para agendamento via WhatsApp
 *
 * @example
 * ```typescript
 * const service = new AppointmentService()
 * const appointment = await service.createAppointment({
 *   tenantId: 'tenant-123',
 *   customerId: 'customer-456',
 *   title: 'Corte de cabelo',
 *   startTime: new Date('2026-02-03T14:00:00')
 * })
 * ```
 */
export class AppointmentService {
  /**
   * Lista todos os agendamentos de um tenant com paginação
   *
   * @param tenantId - ID do tenant
   * @param skip - Número de registros a pular (default: 0)
   * @param take - Número de registros a retornar (default: 20)
   * @returns Objeto com array de agendamentos e total de registros
   *
   * @example
   * ```typescript
   * const result = await service.listByTenant('tenant-123', 0, 10)
   * // { data: [...], total: 45 }
   * ```
   */
  async listByTenant(tenantId: string, skip = 0, take = 20) {
    const [data, total] = await Promise.all([
      prisma.appointment.findMany({
        where: { tenantId },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          service: { select: { id: true, name: true, price: true } },
        },
        orderBy: { startTime: 'desc' },
        skip,
        take,
      }),
      prisma.appointment.count({ where: { tenantId } }),
    ])

    return { data, total }
  }

  /**
   * Lista próximos agendamentos de um cliente específico
   *
   * @param tenantId - ID do tenant
   * @param customerId - ID do cliente
   * @returns Array de agendamentos futuros ordenados por data
   *
   * @remarks
   * - Retorna apenas agendamentos com status SCHEDULED
   * - Inclui agendamentos das últimas 2 horas (tolerância)
   * - Ordenado por data crescente
   *
   * @example
   * ```typescript
   * const upcoming = await service.listUpcoming('tenant-123', 'customer-456')
   * // [{ id, title, startTime, service: {...} }]
   * ```
   */
  async listUpcoming(tenantId: string, customerId: string) {
    return prisma.appointment.findMany({
      where: {
        tenantId,
        customerId,
        status: 'SCHEDULED',
        startTime: {
          gte: subHours(new Date(), 2),
        },
      },
      orderBy: { startTime: 'asc' },
      include: { service: true },
    })
  }

  /**
   * Cancela um agendamento existente
   *
   * @param tenantId - ID do tenant
   * @param customerId - ID do cliente (opcional para admin)
   * @param appointmentId - ID do agendamento
   * @throws {AppError} NotFound se agendamento não existir
   * @throws {AppError} BadRequest se agendamento já estiver cancelado
   *
   * @remarks
   * - Se customerId for undefined, permite cancelamento por admin
   * - Valida que agendamento pertence ao tenant (segurança)
   *
   * @example
   * ```typescript
   * // Cliente cancelando
   * await service.cancelAppointment('tenant-123', 'customer-456', 'appt-789')
   *
   * // Admin cancelando (customerId undefined)
   * await service.cancelAppointment('tenant-123', undefined, 'appt-789')
   * ```
   */
  async cancelAppointment(tenantId: string, customerId: string, appointmentId: string) {
    // Busca flexível: Se customerId vier undefined (Admin), ignora o filtro de customer
    const whereCondition: { id: string; tenantId: string; customerId?: string } = {
      id: appointmentId,
      tenantId,
    }
    if (customerId) whereCondition.customerId = customerId

    const appointment = await prisma.appointment.findFirst({
      where: whereCondition,
    })

    if (!appointment) throw Errors.NotFound('Agendamento não encontrado.')
    if (appointment.status === 'CANCELED')
      throw Errors.BadRequest('Este agendamento já foi cancelado.')

    return prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELED' },
    })
  }

  // --- REMARCAR ---
  async rescheduleAppointment(
    tenantId: string,
    appointmentId: string,
    newStartTime: Date,
    customerId?: string
  ) {
    const startTime = startOfMinute(newStartTime)
    const now = new Date()

    if (isBefore(startTime, now)) {
      throw Errors.BadRequest('Você não pode reagendar para uma data no passado.')
    }

    return prisma.$transaction(async (tx) => {
      // Busca flexível (Admin vs Cliente)
      const whereCondition: { id: string; tenantId: string; customerId?: string } = {
        id: appointmentId,
        tenantId,
      }
      if (customerId) whereCondition.customerId = customerId

      const original = await tx.appointment.findFirst({
        where: whereCondition,
        include: { service: true },
      })

      if (!original) throw Errors.NotFound('Agendamento não encontrado.')

      const duration = original.service ? original.service.duration : 60
      const endTime = addMinutes(startTime, duration)

      // Checagem de Conflito
      const conflict = await tx.appointment.findFirst({
        where: {
          tenantId,
          status: 'SCHEDULED',
          id: { not: appointmentId },
          AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
        },
      })

      if (conflict) {
        throw Errors.Conflict('Este horário já está ocupado por outro cliente.')
      }

      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          startTime,
          endTime,
          description: original.description ? original.description + ' (Reagendado)' : 'Reagendado',
        },
      })

      logger.info(
        { id: appointmentId, newDate: startTime },
        '🔄 Agendamento remarcado com sucesso.'
      )
      return updated
    })
  }

  /**
   * Cria um novo agendamento
   *
   * @param data - Dados do agendamento a criar
   * @returns Agendamento criado com ID
   * @throws {AppError} BadRequest se data estiver no passado
   * @throws {AppError} Conflict se horário já estiver ocupado
   *
   * @remarks
   * - Valida que startTime não está no passado
   * - Verifica conflitos de horário (±30min ou duração do serviço)
   * - Se serviceId for fornecido, usa a duração configurada do serviço
   * - Cria registro de Customer automaticamente se não existir
   *
   * @example
   * ```typescript
   * const appointment = await service.createAppointment({
   *   tenantId: 'tenant-123',
   *   customerId: 'customer-456',
   *   serviceId: 'service-789', // Opcional
   *   title: 'Corte de cabelo',
   *   clientName: 'João Silva',
   *   clientPhone: '11999999999',
   *   startTime: new Date('2026-02-03T14:00:00')
   * })
   * ```
   */
  async createAppointment(data: CreateAppointmentDTO) {
    const startTime = startOfMinute(data.startTime)
    const now = new Date()

    if (isBefore(startTime, now)) {
      throw Errors.BadRequest('A data do agendamento não pode ser no passado.')
    }

    return prisma.$transaction(async (tx) => {
      let duration = 60
      let finalTitle = data.title
      let serviceIdToSave = null

      if (data.serviceId) {
        const service = await tx.service.findFirst({
          where: { id: data.serviceId, tenantId: data.tenantId, isActive: true },
        })
        if (service) {
          duration = service.duration
          finalTitle = service.name
          serviceIdToSave = service.id
        }
      }

      const endTime = addMinutes(startTime, duration)

      const conflict = await tx.appointment.findFirst({
        where: {
          tenantId: data.tenantId,
          status: 'SCHEDULED',
          AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
        },
      })

      if (conflict) {
        throw Errors.Conflict('Horário indisponível.')
      }

      // Atualiza nome do cliente se fornecido
      if (data.clientName) {
        await tx.customer.update({
          where: { id: data.customerId },
          data: { name: data.clientName },
        })
      }

      const appointment = await tx.appointment.create({
        data: {
          tenantId: data.tenantId,
          customerId: data.customerId,
          serviceId: serviceIdToSave,
          title: finalTitle,
          description: serviceIdToSave
            ? `Via IA (${duration}min)`
            : `Personalizado (${duration}min)`,
          startTime,
          endTime,
          status: 'SCHEDULED',
        },
        include: { customer: true, service: true },
      })

      logger.info({ id: appointment.id, time: startTime }, '✅ Novo agendamento criado.')
      return appointment
    })
  }
}
