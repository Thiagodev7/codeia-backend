import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { Errors } from '../lib/errors'
import { prisma } from '../lib/prisma'

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

    // Query otimizada: ordena por última mensagem diretamente no banco
    // Evita ordenação em memória que não escala com muitos clientes
    const conversations = await prisma.$queryRaw<Array<{
      id: string
      name: string | null
      phone: string
      lastMessage: string | null
      lastMessageAt: Date | null
    }>>`
      SELECT 
        c.id,
        c.name,
        c.phone,
        (
          SELECT m.content 
          FROM "Message" m 
          WHERE m."customerId" = c.id 
          ORDER BY m."createdAt" DESC 
          LIMIT 1
        ) as "lastMessage",
        (
          SELECT m."createdAt" 
          FROM "Message" m 
          WHERE m."customerId" = c.id 
          ORDER BY m."createdAt" DESC 
          LIMIT 1
        ) as "lastMessageAt"
      FROM "Customer" c
      WHERE c."tenantId" = ${tenantId}
        AND EXISTS (
          SELECT 1 FROM "Message" m WHERE m."customerId" = c.id
        )
      ORDER BY "lastMessageAt" DESC NULLS LAST
    `

    return conversations.map(c => ({
      id: c.id,
      name: c.name || 'Desconhecido',
      phone: c.phone,
      lastMessage: c.lastMessage || '',
      updatedAt: c.lastMessageAt?.toISOString() || new Date().toISOString()
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