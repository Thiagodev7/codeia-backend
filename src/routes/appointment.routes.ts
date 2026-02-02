import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { Errors } from '../lib/errors'
import {
  buildPaginatedResponse,
  getSkip,
  paginatedResponseSchema,
  paginationQuerySchema,
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
      phone: z.string(),
    }),
    service: z
      .object({
        name: z.string(),
        price: z.any(),
      })
      .nullable(),
  })

  // ---------------------------------------------------------------------------
  // GET /appointments - Listar Todos (Dashboard) com Paginação
  // ---------------------------------------------------------------------------
  app.get(
    '/appointments',
    {
      schema: {
        tags: ['Agenda'],
        summary: 'Listar Agendamentos',
        description:
          'Retorna a agenda paginada da empresa, incluindo detalhes do cliente e serviço.',
        security: [{ bearerAuth: [] }],
        querystring: paginationQuerySchema,
        response: {
          200: paginatedResponseSchema(appointmentSchema).describe(
            'Lista paginada de agendamentos'
          ),
        },
        examples: [
          {
            name: 'Dashboard Agenda',
            summary: 'Lista de agendamentos do dia',
            value: {
              data: [
                {
                  id: 'appt-123',
                  title: 'Corte de Cabelo',
                  startTime: '2026-02-02T14:00:00.000Z',
                  endTime: '2026-02-02T15:00:00.000Z',
                  status: 'SCHEDULED',
                  customer: { id: 'cust-123', name: 'Cliente A', phone: '11999999999' },
                  service: { name: 'Corte Masculino', price: 50 },
                },
              ],
              meta: { total: 1, page: 1, limit: 10, pages: 1 },
            },
          },
        ],
      },
    },
    async (req) => {
      const { tenantId } = req.user as { tenantId: string }
      const { page, limit } = req.query as { page: number; limit: number }

      const { data, total } = await service.listByTenant(tenantId, getSkip(page, limit), limit)

      // Zod transforma strings ISO8601 em Date automaticamente na entrada,
      // mas na saída precisamos garantir que seja string ISO
      const formattedData = data.map((a) => ({
        ...a,
        startTime: a.startTime.toISOString(),
        endTime: a.endTime.toISOString(),
        // Se o serviço tiver createdAt (Date), também precisamos converter ou omitir se não estiver no schema de retorno
      })) as any // Casting temporário para evitar incompatibilidade estrita do Zod Inference com Date vs String

      return buildPaginatedResponse(formattedData, total, page, limit)
    }
  )

  // ---------------------------------------------------------------------------
  // POST /appointments - Criar Agendamento Manual
  // ---------------------------------------------------------------------------
  app.post(
    '/appointments',
    {
      schema: {
        tags: ['Agenda'],
        summary: 'Criar Agendamento',
        description: 'Permite que o administrador crie um agendamento manualmente.',
        security: [{ bearerAuth: [] }],
        body: z.object({
          customerId: z.string().uuid('ID do cliente inválido'),
          serviceId: z.string().uuid().optional(),
          title: z.string().min(3, 'Título obrigatório se não houver serviço').optional(),
          startTime: z.string().datetime('Data inválida (ISO 8601)'),
        }),
        response: {
          201: appointmentSchema.describe('Agendamento criado com sucesso'),
        },
        examples: [
          {
            name: 'Novo Agendamento',
            summary: 'Criação de agendamento manual',
            value: {
              customerId: 'cust-123',
              serviceId: 'svc-456',
              startTime: '2026-02-03T10:00:00.000Z',
            },
          },
        ],
      },
    },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { customerId, serviceId, title, startTime } = req.body

      // Se não tem serviceId, o título é obrigatório.
      const finalTitle = title || 'Agendamento Manual'

      const appointment = await service.createAppointment({
        tenantId,
        customerId,
        serviceId,
        title: finalTitle,
        startTime: new Date(startTime),
      })

      const response = {
        ...appointment,
        startTime: appointment.startTime.toISOString(),
        endTime: appointment.endTime.toISOString(),
      }

      return reply.status(201).send(response)
    }
  )

  // ---------------------------------------------------------------------------
  // PUT /appointments/:id - Reagendar
  // ---------------------------------------------------------------------------
  app.put(
    '/appointments/:id',
    {
      schema: {
        tags: ['Agenda'],
        summary: 'Reagendar',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          newStartTime: z.string().datetime('Data inválida (ISO 8601)'),
        }),
      },
    },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { id } = req.params
      const { newStartTime } = req.body

      // Como é admin, não passamos customerId (bypass na verificação de posse)
      const updated = await service.rescheduleAppointment(tenantId, id, new Date(newStartTime))

      return reply.send(updated)
    }
  )

  // ---------------------------------------------------------------------------
  // DELETE /appointments/:id - Cancelar
  // ---------------------------------------------------------------------------
  app.delete(
    '/appointments/:id',
    {
      schema: {
        tags: ['Agenda'],
        summary: 'Cancelar Agendamento',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { id } = req.params

      // Passamos customerId vazio para indicar operação administrativa (Service adaptado)
      await service.cancelAppointment(tenantId, '', id)

      return reply.status(204).send()
    }
  ) as any // Casting para resolver conflito de tipagem estrita do Zod com handler async
}
