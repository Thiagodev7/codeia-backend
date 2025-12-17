import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { startOfMinute, isBefore, addMinutes } from 'date-fns'

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
        status: 'SCHEDULED', // Apenas agendamentos ativos
        startTime: {
          gte: new Date() // Apenas futuros
        }
      },
      orderBy: { startTime: 'asc' },
      include: { service: true }
    })
  }

  // --- CANCELAR ---
  async cancelAppointment(tenantId: string, customerId: string, appointmentId: string) {
    // Verifica propriedade antes de cancelar
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId, customerId }
    })

    if (!appointment) {
      throw new Error('NOT_FOUND: Agendamento não encontrado ou não pertence a você.')
    }

    if (appointment.status === 'CANCELED') {
      throw new Error('ALREADY_CANCELED: Este agendamento já foi cancelado.')
    }

    // Soft Delete (Muda status para CANCELED)
    return prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELED' }
    })
  }

  // --- REMARCAR ---
  async rescheduleAppointment(tenantId: string, customerId: string, appointmentId: string, newStartTime: Date) {
    const startTime = startOfMinute(newStartTime)

    if (isBefore(startTime, new Date())) {
      throw new Error('VALIDATION_ERROR: Não é possível reagendar para o passado.')
    }

    return prisma.$transaction(async (tx) => {
      // 1. Busca o agendamento original para pegar a duração e validar dono
      const original = await tx.appointment.findFirst({
        where: { id: appointmentId, tenantId, customerId },
        include: { service: true }
      })

      if (!original) throw new Error('NOT_FOUND: Agendamento não encontrado.')
      
      // Define duração: usa a do serviço vinculado ou assume 60min se for personalizado
      const duration = original.service ? original.service.duration : 60
      const endTime = addMinutes(startTime, duration)

      // 2. Validação de Conflito (Overlap) - IGNORANDO o próprio agendamento atual
      const conflict = await tx.appointment.findFirst({
        where: {
          tenantId,
          status: 'SCHEDULED',
          id: { not: appointmentId }, // <--- CRÍTICO: Não colidir consigo mesmo
          AND: [
            { startTime: { lt: endTime } },
            { endTime: { gt: startTime } }
          ]
        }
      })

      if (conflict) {
        throw new Error('CONFLICT_ERROR: O novo horário solicitado já está ocupado.')
      }

      // 3. Atualiza
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          startTime,
          endTime,
          description: original.description ? original.description + " (Remarcado)" : "Remarcado via IA"
        }
      })

      logger.info({ appointmentId, newDate: startTime }, '🔄 [Appointment] Remarcado com sucesso.')
      return updated
    })
  }

  // --- CRIAR (Mantido da versão anterior com melhoria de reuso) ---
  async createAppointment(data: CreateAppointmentDTO) {
    const startTime = startOfMinute(data.startTime)
    
    if (isBefore(startTime, new Date())) {
      throw new Error('VALIDATION_ERROR: Não é possível agendar em uma data/hora passada.')
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
          description: serviceIdToSave ? `Agendado via IA. Duração: ${duration}min` : `Personalizado. Duração: ${duration}min`,
          startTime,
          endTime,
          status: 'SCHEDULED'
        },
        include: { customer: true, service: true }
      })

      return appointment
    })
  }
}