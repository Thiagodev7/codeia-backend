import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { TenantService } from '../services/tenant.service'
import { Errors } from '../lib/errors'

/**
 * Rotas da Empresa (Tenant)
 * Configurações da conta e dados da organização.
 */
export const tenantRoutes: FastifyPluginAsyncZod = async (app) => {
  // Middleware de Segurança
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido ou expirado.')
    }
  })
  
  const tenantService = new TenantService()

  // ---------------------------------------------------------------------------
  // GET /tenant/me - Dados da Empresa
  // ---------------------------------------------------------------------------
  app.get('/tenant/me', {
    schema: {
      tags: ['Configurações da Empresa'],
      summary: 'Dados da Empresa',
      description: 'Retorna detalhes da conta, plano atual e contadores para o dashboard.',
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
            messages: z.number(),
            appointments: z.number().optional()
          })
        })
      }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    
    // O Service já lança AppError se não encontrar
    const me = await tenantService.getDetails(tenantId)

    return me
  })

  // ---------------------------------------------------------------------------
  // PUT /tenant/me - Atualizar Dados
  // ---------------------------------------------------------------------------
  app.put('/tenant/me', {
    schema: {
      tags: ['Configurações da Empresa'],
      summary: 'Atualizar Dados',
      description: 'Atualiza informações cadastrais da empresa.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string().optional(),
        phone: z.string().optional()
      }),
      response: {
        200: z.object({
          id: z.string(),
          name: z.string(),
          updatedAt: z.date()
        })
      }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const updated = await tenantService.update(tenantId, req.body)
    return reply.send(updated)
  })
}