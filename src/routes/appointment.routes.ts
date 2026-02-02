import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { Errors } from '../lib/errors'
import {
    buildPaginatedResponse,
    getSkip,
    paginatedResponseSchema,
    paginationQuerySchema
} from '../lib/pagination'
import { AppointmentService } from '../services/appointment.service'

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

  const appointmentSchema = z.object({
    id: z.string(),
    title: z.string(),
    startTime: z.string(),
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
  })

  // ---------------------------------------------------------------------------
  // GET /appointments - Listar Todos (Dashboard) com Paginação
  // ---------------------------------------------------------------------------
  app.get('/appointments', {
    schema: {
      tags: ['Agenda'],
      summary: 'Listar Agendamentos',
      description: 'Retorna a agenda paginada da empresa, incluindo detalhes do cliente e serviço.',
      security: [{ bearerAuth: [] }],
      querystring: paginationQuerySchema,
      response: {
        200: paginatedResponseSchema(appointmentSchema)
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const { page, limit } = req.query as { page: number, limit: number }
    
    const { data, total } = await service.listByTenant(tenantId, getSkip(page, limit), limit)
    
    const formattedData = data.map(a => ({
      ...a,
      startTime: a.startTime.toISOString(),
      endTime: a.endTime.toISOString()
    }))
    
    return buildPaginatedResponse(formattedData, total, page, limit)
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