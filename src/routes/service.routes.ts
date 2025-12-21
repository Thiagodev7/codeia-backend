import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ServiceService } from '../services/service.service'
import { Errors } from '../lib/errors'

/**
 * Rotas de Serviços
 * Catálogo de serviços oferecidos pela empresa (usados pela IA para agendamento).
 */
export const serviceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido')
    }
  })

  const service = new ServiceService()

  // ---------------------------------------------------------------------------
  // GET /services - Catálogo
  // ---------------------------------------------------------------------------
  app.get('/services', {
    schema: {
      tags: ['Serviços'],
      summary: 'Listar Serviços',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          name: z.string(),
          duration: z.number(),
          price: z.any(), // Decimal do Prisma serializado
          description: z.string().nullable()
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return service.list(tenantId)
  })

  // ---------------------------------------------------------------------------
  // POST /services - Novo Serviço
  // ---------------------------------------------------------------------------
  app.post('/services', {
    schema: {
      tags: ['Serviços'],
      summary: 'Criar Serviço',
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string().min(1, "Nome obrigatório"),
        duration: z.number().min(5, "Duração mínima de 5 min"),
        price: z.number().min(0, "O preço não pode ser negativo"),
        description: z.string().optional()
      }),
      response: {
        201: z.object({
          id: z.string(),
          name: z.string()
        })
      }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const result = await service.create(tenantId, req.body)
    return reply.status(201).send(result)
  })

  // ---------------------------------------------------------------------------
  // DELETE /services/:id - Remover Serviço
  // ---------------------------------------------------------------------------
  app.delete('/services/:id', {
    schema: {
      tags: ['Serviços'],
      summary: 'Excluir Serviço',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    await service.delete(tenantId, req.params.id)
    return reply.status(204).send()
  })
}