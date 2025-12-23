// src/routes/settings.routes.ts
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { SettingsService } from '../services/settings.service'
import { Errors } from '../lib/errors'

/**
 * Rotas de Configurações
 */
export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Middleware de Segurança: Exige autenticação JWT em todas as rotas
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido ou expirado.')
    }
  })

  const service = new SettingsService()

  // ===========================================================================
  // CONFIGURAÇÕES DA EMPRESA (TENANT)
  // ===========================================================================
  
  // GET /settings/tenant - Visualizar configurações
  app.get('/settings/tenant', {
    schema: {
      tags: ['Configurações'],
      summary: 'Configurações da Empresa',
      description: 'Retorna personalização visual e regras de negócio da empresa.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          id: z.string(),
          primaryColor: z.string(),
          logoUrl: z.string().nullable(),
          timezone: z.string(),
          businessHours: z.any().nullable()
        })
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return service.getTenantSettings(tenantId)
  })

  // PUT /settings/tenant - Atualizar configurações (Somente ADMIN)
  app.put('/settings/tenant', {
    schema: {
      tags: ['Configurações'],
      summary: 'Atualizar Empresa',
      security: [{ bearerAuth: [] }],
      body: z.object({
        primaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Cor inválida (Use Hex: #RRGGBB)").optional(),
        logoUrl: z.string().url("URL de logo inválida").optional().or(z.literal('')),
        timezone: z.string().optional(),
        businessHours: z.any().optional() // JSON livre para horários
      })
    }
  }, async (req, reply) => {
    const { tenantId, role } = req.user as { tenantId: string, role: string }
    
    // Regra de Negócio: Proteção de acesso
    if (role !== 'ADMIN') {
        throw Errors.Forbidden('Apenas administradores podem alterar configurações globais da empresa.')
    }

    const updated = await service.updateTenantSettings(tenantId, req.body)
    return reply.send(updated)
  })

  // ===========================================================================
  // PREFERÊNCIAS DO USUÁRIO (ME)
  // ===========================================================================

  // GET /settings/me - Minhas preferências
  app.get('/settings/me', {
    schema: {
      tags: ['Configurações'],
      summary: 'Minhas Preferências',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          theme: z.string(),
          language: z.string(),
          emailAlerts: z.boolean(),
          whatsappAlerts: z.boolean()
        })
      }
    }
  }, async (req) => {
    const { sub: userId } = req.user as { sub: string }
    return service.getUserSettings(userId)
  })

  // PUT /settings/me - Atualizar minhas preferências
  app.put('/settings/me', {
    schema: {
      tags: ['Configurações'],
      summary: 'Atualizar Minhas Preferências',
      security: [{ bearerAuth: [] }],
      body: z.object({
        theme: z.enum(['light', 'dark', 'system']).optional(),
        language: z.string().optional(),
        emailAlerts: z.boolean().optional(),
        whatsappAlerts: z.boolean().optional()
      })
    }
  }, async (req, reply) => {
    const { sub: userId } = req.user as { sub: string }
    const updated = await service.updateUserSettings(userId, req.body)
    return reply.send(updated)
  })
}