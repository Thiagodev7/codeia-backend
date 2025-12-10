import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { TenantService } from '../services/tenant.service'

export const tenantRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => await req.jwtVerify())
  const tenantService = new TenantService()

  // MEUS DADOS
  app.get('/tenant/me', {
    schema: {
      tags: ['Company Settings'],
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          id: z.string(),
          name: z.string(),
          document: z.string(),
          plan: z.string(),
          _count: z.object({
            users: z.number(),
            customers: z.number(),
            messages: z.number()
          })
        })
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return tenantService.getDetails(tenantId)
  })

  // ATUALIZAR DADOS
  app.put('/tenant/me', {
    schema: {
      tags: ['Company Settings'],
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string().optional(),
        phone: z.string().optional()
      })
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return tenantService.update(tenantId, req.body)
  })
}