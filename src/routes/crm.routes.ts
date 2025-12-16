import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

export const crmRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => await req.jwtVerify())

  // 1. LISTAR CONVERSAS (Clientes que têm mensagens)
  app.get('/crm/conversations', {
    schema: {
      tags: ['CRM'],
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          name: z.string().nullable(),
          phone: z.string(),
          lastMessage: z.string().nullable(),
          updatedAt: z.string() // Data da última mensagem
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }

    // Busca clientes que têm mensagens, ordenados pelos mais recentes
    const customers = await prisma.customer.findMany({
      where: { 
        tenantId,
        messages: { some: {} } // Só traz quem tem mensagem
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })

    // Ordena via código (quem tem mensagem mais nova primeiro)
    const sorted = customers.sort((a, b) => {
      const dateA = a.messages[0]?.createdAt.getTime() || 0
      const dateB = b.messages[0]?.createdAt.getTime() || 0
      return dateB - dateA
    })

    return sorted.map(c => ({
      id: c.id,
      name: c.name || 'Desconhecido',
      phone: c.phone,
      lastMessage: c.messages[0]?.content || '',
      updatedAt: c.messages[0]?.createdAt.toISOString() || new Date().toISOString()
    }))
  })

  // 2. PEGAR HISTÓRICO DE UM CLIENTE
  app.get('/crm/conversations/:customerId/messages', {
    schema: {
      tags: ['CRM'],
      security: [{ bearerAuth: [] }],
      params: z.object({ customerId: z.string() }),
      response: {
        200: z.array(z.object({
          id: z.string(),
          role: z.string(),
          content: z.string(),
          createdAt: z.string()
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const { customerId } = req.params

    const messages = await prisma.message.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'asc' } // Do mais antigo pro mais novo
    })

    return messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString()
    }))
  })
}