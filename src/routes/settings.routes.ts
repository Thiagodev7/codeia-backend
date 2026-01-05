import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { SettingsService } from '../services/settings.service'
import { Errors } from '../lib/errors'

export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido ou expirado.')
    }
  })

  const service = new SettingsService()

  // ---------------------------------------------------------------------------
  // GET /settings/tenant - Buscar Configurações
  // ---------------------------------------------------------------------------
  app.get('/settings/tenant', {
    schema: {
      tags: ['Configurações'],
      summary: 'Configurações da Empresa',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          id: z.string(),
          primaryColor: z.string(),
          logoUrl: z.string().nullable(),
          timezone: z.string(),
          // businessHours agora vem via 'businessHours' (array da nova tabela) ou tratado no service
          businessHours: z.array(z.object({
            dayOfWeek: z.number(),
            startTime: z.string(),
            endTime: z.string(),
            isOpen: z.boolean()
          })).optional(),
          
          businessName: z.string().nullable(),
          description: z.string().nullable(),
          address: z.string().nullable(),
          contactPhone: z.string().nullable(),
          website: z.string().nullable(),

          // ✅ NOVOS CAMPOS (Correção Principal)
          reminderEnabled: z.boolean(),
          reminderMinutes: z.number()
        })
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const data = await service.getTenantSettings(tenantId)
    
    // Garante valores default se vierem nulos do banco (para passar no Zod)
    return {
      ...data,
      reminderEnabled: data.reminderEnabled ?? false,
      reminderMinutes: data.reminderMinutes ?? 60
    }
  })

  // ---------------------------------------------------------------------------
  // PUT /settings/tenant - Atualizar Configurações
  // ---------------------------------------------------------------------------
  app.put('/settings/tenant', {
    schema: {
      tags: ['Configurações'],
      summary: 'Atualizar Empresa',
      security: [{ bearerAuth: [] }],
      body: z.object({
        primaryColor: z.string().regex(/^#/, "Deve ser Hex").optional(),
        logoUrl: z.string().url().optional().or(z.literal('')).or(z.null()), 
        timezone: z.string().optional(),
        
        // Array de horários
        businessHours: z.array(z.object({
          dayOfWeek: z.number(),
          startTime: z.string(),
          endTime: z.string(),
          isOpen: z.boolean()
        })).optional(),

        businessName: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        contactPhone: z.string().nullable().optional(),
        website: z.string().nullable().optional(),

        // ✅ NOVOS CAMPOS NO BODY (Correção Principal)
        reminderEnabled: z.boolean().optional(),
        reminderMinutes: z.number().optional()
      })
    }
  }, async (req, reply) => {
    const { tenantId, role } = req.user as { tenantId: string, role: string }
    
    if (role !== 'ADMIN') {
        throw Errors.Forbidden('Apenas administradores podem alterar configurações.')
    }

    const updated = await service.updateTenantSettings(tenantId, req.body)
    return reply.send(updated)
  })

  // ---------------------------------------------------------------------------
  // User Settings (Mantido igual)
  // ---------------------------------------------------------------------------
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