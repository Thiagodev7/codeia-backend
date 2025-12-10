import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ServiceService } from '../services/service.service'

export const serviceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => await req.jwtVerify())
  const service = new ServiceService()

  app.get('/services', {
    schema: {
      tags: ['Services'],
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          name: z.string(),
          duration: z.number(),
          price: z.any(), // Decimal do Prisma as vezes precisa de tratamento, any facilita o MVP
          description: z.string().nullable()
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return service.list(tenantId)
  })

  app.post('/services', {
    schema: {
      tags: ['Services'],
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string(),
        duration: z.number().min(5),
        price: z.number().min(0),
        description: z.string().optional()
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const result = await service.create(tenantId, req.body)
    return reply.status(201).send(result)
  })

  app.delete('/services/:id', {
    schema: {
      tags: ['Services'],
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string() })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    await service.delete(tenantId, req.params.id)
    return reply.status(204).send()
  })
}