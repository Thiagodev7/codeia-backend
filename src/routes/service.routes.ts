import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ServiceService } from '../services/service.service'
import { Errors } from '../lib/errors'

export const serviceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido')
    }
  })

  const service = new ServiceService()

  // LISTAR
  app.get('/services', {
    schema: {
      tags: ['Serviços'],
      summary: 'Listar serviços',
      security: [{ bearerAuth: [] }],
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return service.list(tenantId)
  })

  // CRIAR
  app.post('/services', {
    schema: {
      tags: ['Serviços'],
      summary: 'Criar serviço',
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string().min(1),
        description: z.string().nullable().optional(), // Aceita null
        price: z.number().min(0),
        duration: z.number().min(1)
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    // Cast para any para evitar conflito estrito de tipos null/undefined, o Zod já validou
    return reply.status(201).send(await service.create(tenantId, req.body as any))
  })

  // ATUALIZAR
  app.put('/services/:id', {
    schema: {
      tags: ['Serviços'],
      summary: 'Atualizar serviço',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string() }),
      body: z.object({
        name: z.string().optional(),
        description: z.string().nullable().optional(), // Aceita null
        price: z.number().optional(),
        duration: z.number().optional(),
        isActive: z.boolean().optional()
      })
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params
    return service.update(tenantId, id, req.body as any)
  })

  // DELETAR
  app.delete('/services/:id', {
    schema: {
      tags: ['Serviços'],
      summary: 'Remover serviço',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string() })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params
    await service.delete(tenantId, id)
    return reply.status(204).send()
  })
}