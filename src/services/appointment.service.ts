import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { startOfMinute, isBefore, addMinutes, subHours } from 'date-fns'

interface CreateAppointmentDTO {
  tenantId: string
  customerId: string
  serviceId?: string
  title: string
  clientName?: string
  clientPhone?: string
  startTime: Date
}

export class AppointmentService {
  
  // --- LISTAR ---
  async listUpcoming(tenantId: string, customerId: string) {
    return prisma.appointment.findMany({
      where: {
        tenantId,
        customerId,
        status: 'SCHEDULED',
        startTime: {
          // Busca agendamentos de até 2 horas atrás em diante (para não sumir imediatamente)
          gte: subHours(new Date(), 2) 
        }
      },
      orderBy: { startTime: 'asc' },
      include: { service: true }
    })
  }

  // --- CANCELAR ---
  async cancelAppointment(tenantId: string, customerId: string, appointmentId: string) {
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId, customerId }
    })

    if (!appointment) throw new Error('NOT_FOUND: Agendamento não encontrado ou não pertence a você.')
    if (appointment.status === 'CANCELED') throw new Error('ALREADY_CANCELED: Já estava cancelado.')

    return prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELED' }
    })
  }

  // --- REMARCAR ---
  async rescheduleAppointment(tenantId: string, customerId: string, appointmentId: string, newStartTime: Date) {
    // 1. Normalização e Validação
    const startTime = startOfMinute(newStartTime)
    const now = new Date()

    // LOG DE DEBUG PARA O ERRO DE DATA
    if (isBefore(startTime, now)) {
      logger.warn({ 
        tentativa: startTime.toISOString(), 
        agora: now.toISOString(),
        diff: (startTime.getTime() - now.getTime()) 
      }, '⚠️ Bloqueio: Tentativa de agendar no passado')
      
      throw new Error('VALIDATION_ERROR: Data no passado.')
    }

    return prisma.$transaction(async (tx) => {
      const original = await tx.appointment.findFirst({
        where: { id: appointmentId, tenantId, customerId },
        include: { service: true }
      })

      if (!original) throw new Error('NOT_FOUND: Agendamento não encontrado.')
      
      const duration = original.service ? original.service.duration : 60
      const endTime = addMinutes(startTime, duration)

      // 2. Validação de Conflito
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

      if (conflict) throw new Error('CONFLICT_ERROR: Horário ocupado.')

      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          startTime,
          endTime,
          description: original.description ? original.description + " (Remarcado)" : "Remarcado via IA"
        }
      })

      logger.info({ id: appointmentId, newDate: startTime }, '🔄 Agendamento remarcado.')
      return updated
    })
  }

  // --- CRIAR ---
  async createAppointment(data: CreateAppointmentDTO) {
    const startTime = startOfMinute(data.startTime)
    const now = new Date()

    // LOG DE DEBUG
    if (isBefore(startTime, now)) {
      logger.warn({ 
        tentativa: startTime.toISOString(), 
        agora: now.toISOString() 
      }, '⚠️ Bloqueio: Data no passado')
      throw new Error('VALIDATION_ERROR: Data no passado.')
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
        throw new Error('CONFLICT_ERROR: Horário indisponível.')
      }

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

      logger.info({ id: appointment.id }, '✅ Agendamento criado.')
      return appointment
    })
  }
}