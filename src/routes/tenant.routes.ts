import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { TenantService } from '../services/tenant.service'
import { prisma } from '../lib/prisma'

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
            messages: z.number(),
            appointments: z.number().optional()
          })
        }),
        404: z.object({
          message: z.string()
        })
      }
    }
  }, async (req, reply) => { // Adicionado 'reply'
    const { tenantId } = req.user as { tenantId: string }
    
    const me = await tenantService.getDetails(tenantId)

    if (!me) {
      return reply.status(404).send({ message: "Tenant not found" })
    }

    return me
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

  // AGENDA
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
    
    const appointments = await prisma.appointment.findMany({
      where: { tenantId },
      include: { customer: { select: { name: true } } },
      orderBy: { startTime: 'desc' }
    })

    return appointments.map(app => ({
      ...app,
      startTime: app.startTime.toISOString()
    }))
  })
}