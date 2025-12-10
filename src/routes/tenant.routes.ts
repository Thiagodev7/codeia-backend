import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { TenantService } from '../services/tenant.service'
import { prisma } from '../lib/prisma' // Importar prisma direto para listagens simples

export const tenantRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => await req.jwtVerify())
  
  const tenantService = new TenantService()

  // MEUS DADOS (Dashboard)
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
            messages: z.number(),
            appointments: z.number().optional() // Opcional para evitar erro se faltar no banco
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

  // --- NOVA ROTA: LISTAR AGENDAMENTOS (Agenda) ---
  app.get('/appointments', {
    schema: {
      tags: ['Company Settings'],
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          title: z.string(),
          startTime: z.string(),
          status: z.string(),
          customer: z.object({ 
            name: z.string().nullable() 
          }).nullable()
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    
    // Busca agendamentos ordenados por data
    const appointments = await prisma.appointment.findMany({
      where: { tenantId },
      include: { 
        customer: { 
          select: { name: true } 
        } 
      },
      orderBy: { startTime: 'desc' }
    })

    // Converter Date para String ISO para validação do Zod
    return appointments.map(app => ({
      ...app,
      startTime: app.startTime.toISOString()
    }))
  })
}