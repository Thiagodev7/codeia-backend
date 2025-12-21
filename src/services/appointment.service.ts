import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { startOfMinute, isBefore, addMinutes, subHours } from 'date-fns'
import { Errors } from '../lib/errors'

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
 * Núcleo da lógica de calendário, conflitos e validações de data.
 */
export class AppointmentService {
  
  // --- [NOVO] LISTAR TUDO (Dashboard) ---
  async listByTenant(tenantId: string) {
    return prisma.appointment.findMany({
      where: { tenantId },
      include: { 
        customer: { select: { id: true, name: true, phone: true } },
        service: { select: { id: true, name: true, price: true } }
      },
      orderBy: { startTime: 'desc' }
    })
  }

  // --- LISTAR (Cliente/IA) ---
  async listUpcoming(tenantId: string, customerId: string) {
    return prisma.appointment.findMany({
      where: {
        tenantId,
        customerId,
        status: 'SCHEDULED',
        startTime: {
          gte: subHours(new Date(), 2) 
        }
      },
      orderBy: { startTime: 'asc' },
      include: { service: true }
    })
  }

  // --- CANCELAR ---
  async cancelAppointment(tenantId: string, customerId: string, appointmentId: string) {
    // Busca flexível: Se customerId vier undefined (Admin), ignora o filtro de customer
    const whereCondition: any = { id: appointmentId, tenantId }
    if (customerId) whereCondition.customerId = customerId

    const appointment = await prisma.appointment.findFirst({
      where: whereCondition
    })

    if (!appointment) throw Errors.NotFound('Agendamento não encontrado.')
    if (appointment.status === 'CANCELED') throw Errors.BadRequest('Este agendamento já foi cancelado.')

    return prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELED' }
    })
  }

  // --- REMARCAR ---
  async rescheduleAppointment(tenantId: string, appointmentId: string, newStartTime: Date, customerId?: string) {
    const startTime = startOfMinute(newStartTime)
    const now = new Date()

    if (isBefore(startTime, now)) {
      throw Errors.BadRequest('Você não pode reagendar para uma data no passado.')
    }

    return prisma.$transaction(async (tx) => {
      // Busca flexível (Admin vs Cliente)
      const whereCondition: any = { id: appointmentId, tenantId }
      if (customerId) whereCondition.customerId = customerId

      const original = await tx.appointment.findFirst({
        where: whereCondition,
        include: { service: true }
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
          AND: [
            { startTime: { lt: endTime } },
            { endTime: { gt: startTime } }
          ]
        }
      })

      if (conflict) {
        throw Errors.Conflict('Este horário já está ocupado por outro cliente.')
      }

      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          startTime,
          endTime,
          description: original.description ? original.description + " (Reagendado)" : "Reagendado"
        }
      })

      logger.info({ id: appointmentId, newDate: startTime }, '🔄 Agendamento remarcado com sucesso.')
      return updated
    })
  }

  // --- CRIAR ---
  async createAppointment(data: CreateAppointmentDTO) {
    const startTime = startOfMinute(data.startTime)
    const now = new Date()

    if (isBefore(startTime, now)) {
      throw Errors.BadRequest('A data do agendamento não pode ser no passado.')
    }

    return prisma.$transaction(async (tx) => {
      let duration = 60; 
      let finalTitle = data.title;
      let serviceIdToSave = null;

      if (data.serviceId) {
        const service = await tx.service.findFirst({
          where: { id: data.serviceId, tenantId: data.tenantId, isActive: true }
        })
        if (service) {
          duration = service.duration;
          finalTitle = service.name;
          serviceIdToSave = service.id;
        }
      }

      const endTime = addMinutes(startTime, duration)

      const conflict = await tx.appointment.findFirst({
        where: {
          tenantId: data.tenantId,
          status: 'SCHEDULED',
          AND: [
            { startTime: { lt: endTime } },
            { endTime: { gt: startTime } }
          ]
        }
      })

      if (conflict) {
        throw Errors.Conflict('Horário indisponível.')
      }

      // Atualiza nome do cliente se fornecido
      if (data.clientName) {
        await tx.customer.update({
          where: { id: data.customerId },
          data: { name: data.clientName }
        })
      }

      const appointment = await tx.appointment.create({
        data: {
          tenantId: data.tenantId,
          customerId: data.customerId,
          serviceId: serviceIdToSave,
          title: finalTitle,
          description: serviceIdToSave ? `Via IA (${duration}min)` : `Personalizado (${duration}min)`,
          startTime,
          endTime,
          status: 'SCHEDULED'
        },
        include: { customer: true, service: true }
      })

      logger.info({ id: appointment.id, time: startTime }, '✅ Novo agendamento criado.')
      return appointment
    })
  }
}