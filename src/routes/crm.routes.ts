import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { Errors } from '../lib/errors'

/**
 * Rotas de CRM (Monitoramento)
 * Visualização de conversas e histórico de mensagens dos clientes.
 */
export const crmRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido')
    }
  })

  // ---------------------------------------------------------------------------
  // GET /crm/conversations - Listar Conversas Ativas
  // ---------------------------------------------------------------------------
  app.get('/crm/conversations', {
    schema: {
      tags: ['CRM / Monitoramento'],
      summary: 'Listar Conversas',
      description: 'Retorna lista de clientes com conversas recentes, ordenados por última mensagem.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          name: z.string().nullable(),
          phone: z.string(),
          lastMessage: z.string().nullable(),
          updatedAt: z.string()
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }

    // Busca clientes que possuem mensagens
    const customers = await prisma.customer.findMany({
      where: { 
        tenantId,
        messages: { some: {} } 
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })

    // Ordenação em memória: Clientes com mensagens mais recentes primeiro
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

  // ---------------------------------------------------------------------------
  // GET /crm/conversations/:customerId/messages - Histórico de Chat
  // ---------------------------------------------------------------------------
  app.get('/crm/conversations/:customerId/messages', {
    schema: {
      tags: ['CRM / Monitoramento'],
      summary: 'Histórico de Mensagens',
      description: 'Recupera o chat completo entre a IA e o cliente.',
      security: [{ bearerAuth: [] }],
      params: z.object({ customerId: z.string().uuid() }),
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
      orderBy: { createdAt: 'asc' } // Ordem cronológica (antigo -> novo)
    })

    return messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString()
    }))
  })
}