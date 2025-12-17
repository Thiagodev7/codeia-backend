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
  /**
   * Cria um agendamento. Se o serviço não existir (serviceId undefined),
   * cria como "Personalizado" com duração padrão de 60min.
   */
  async createAppointment(data: CreateAppointmentDTO) {
    // 1. Normalização de Datas
    const startTime = startOfMinute(data.startTime)
    
    if (isBefore(startTime, new Date())) {
      throw new Error('VALIDATION_ERROR: Não é possível agendar em uma data/hora passada.')
    }

    return prisma.$transaction(async (tx) => {
      // 2. Definição da Duração e Título
      let duration = 60; // Duração padrão (em minutos) para serviços não cadastrados
      let finalTitle = data.title;
      let serviceIdToSave = null;

      // Se veio um ID, buscamos as configs reais do banco
      if (data.serviceId) {
        const service = await tx.service.findFirst({
          where: { id: data.serviceId, tenantId: data.tenantId, isActive: true }
        })

        if (service) {
          duration = service.duration;
          finalTitle = service.name; // Garante o nome oficial
          serviceIdToSave = service.id;
        }
      }

      // 3. Cálculo do Horário de Término
      const endTime = addMinutes(startTime, duration)

      // 4. Validação de Conflito (Overlap)
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

      // 5. Enriquecimento do Cliente (Update ou Create implícito se não existisse)
      if (data.clientName) {
        await tx.customer.update({
          where: { id: data.customerId },
          data: { name: data.clientName }
        })
      }

      // 6. Persistência
      const appointment = await tx.appointment.create({
        data: {
          tenantId: data.tenantId,
          customerId: data.customerId,
          serviceId: serviceIdToSave, 
          title: finalTitle,
          description: serviceIdToSave 
            ? `Agendado via IA. Duração: ${duration}min` 
            : `Serviço Personalizado (Não cadastrado). Duração padrão: ${duration}min`,
          startTime,
          endTime,
          status: 'SCHEDULED'
        },
        include: {
          customer: true,
          service: true 
        }
      })

      logger.info(
        { appointmentId: appointment.id, isCustom: !serviceIdToSave }, 
        '✅ [Appointment] Agendamento criado.'
      )

      return appointment
    })
  }
}