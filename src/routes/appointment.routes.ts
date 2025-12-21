import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { AppointmentService } from '../services/appointment.service'
import { Errors } from '../lib/errors'

/**
 * Rotas de Agenda (Appointments)
 * Gerenciamento completo de agendamentos pelo painel administrativo.
 */
export const appointmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido')
    }
  })

  const service = new AppointmentService()

  // ---------------------------------------------------------------------------
  // GET /appointments - Listar Todos (Dashboard)
  // ---------------------------------------------------------------------------
  app.get('/appointments', {
    schema: {
      tags: ['Agenda'],
      summary: 'Listar Agendamentos',
      description: 'Retorna a agenda completa da empresa, incluindo detalhes do cliente e serviço.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          title: z.string(),
          startTime: z.string(), // O Prisma retorna Date, o Fastify serializa para String ISO
          endTime: z.string(),
          status: z.string(),
          customer: z.object({
            id: z.string(),
            name: z.string().nullable(),
            phone: z.string()
          }),
          service: z.object({
            name: z.string(),
            price: z.any()
          }).nullable()
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const appointments = await service.listByTenant(tenantId)
    
    // Pequena transformação para garantir formato ISO nas datas
    return appointments.map(a => ({
      ...a,
      startTime: a.startTime.toISOString(),
      endTime: a.endTime.toISOString()
    }))
  })

  // ---------------------------------------------------------------------------
  // POST /appointments - Criar Agendamento Manual
  // ---------------------------------------------------------------------------
  app.post('/appointments', {
    schema: {
      tags: ['Agenda'],
      summary: 'Criar Agendamento',
      description: 'Permite que o administrador crie um agendamento manualmente.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        customerId: z.string().uuid("ID do cliente inválido"),
        serviceId: z.string().uuid().optional(),
        title: z.string().min(3, "Título obrigatório se não houver serviço").optional(),
        startTime: z.string().datetime("Data inválida (ISO 8601)")
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { customerId, serviceId, title, startTime } = req.body

    // Se não tem serviceId, o título é obrigatório.
    const finalTitle = title || "Agendamento Manual"

    const appointment = await service.createAppointment({
      tenantId,
      customerId,
      serviceId,
      title: finalTitle,
      startTime: new Date(startTime)
    })

    return reply.status(201).send(appointment)
  })

  // ---------------------------------------------------------------------------
  // PUT /appointments/:id - Reagendar
  // ---------------------------------------------------------------------------
  app.put('/appointments/:id', {
    schema: {
      tags: ['Agenda'],
      summary: 'Reagendar',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        newStartTime: z.string().datetime("Data inválida (ISO 8601)")
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params
    const { newStartTime } = req.body

    // Como é admin, não passamos customerId (bypass na verificação de posse)
    const updated = await service.rescheduleAppointment(tenantId, id, new Date(newStartTime))
    
    return reply.send(updated)
  })

  // ---------------------------------------------------------------------------
  // DELETE /appointments/:id - Cancelar
  // ---------------------------------------------------------------------------
  app.delete('/appointments/:id', {
    schema: {
      tags: ['Agenda'],
      summary: 'Cancelar Agendamento',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params

    // Passamos customerId vazio para indicar operação administrativa (Service adaptado)
    await service.cancelAppointment(tenantId, '', id)
    
    return reply.status(204).send()
  })
}