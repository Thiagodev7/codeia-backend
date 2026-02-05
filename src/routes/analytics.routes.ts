import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { Errors } from '../lib/errors'
import { AnalyticsService } from '../services/analytics.service'

export const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido')
    }
  })

  const service = new AnalyticsService()

  app.get(
    '/analytics/dashboard',
    {
      schema: {
        tags: ['Analytics'],
        summary: 'Dados do Dashboard',
        description: 'Retorna estatísticas e dados para gráficos do dashboard.',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            stats: z.object({
              customers: z.number(),
              messages: z.number(),
              appointments: z.number(),
              users: z.number(),
            }),
            charts: z.object({
              appointments: z.array(z.object({ name: z.string(), value: z.number() })),
              messages: z.array(z.object({ name: z.string(), value: z.number() })),
            }),
          }),
        },
      },
    },
    async (req) => {
      const { tenantId } = req.user as { tenantId: string }

      const [stats, appointmentsChart, messagesChart] = await Promise.all([
        service.getDashboardStats(tenantId),
        service.getAppointmentsChart(tenantId),
        service.getMessagesChart(tenantId),
      ])

      return {
        stats,
        charts: {
          appointments: appointmentsChart,
          messages: messagesChart,
        },
      }
    }
  )
}
