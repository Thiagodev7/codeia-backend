import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { Errors } from '../lib/errors'
import {
    buildPaginatedResponse,
    getSkip,
    paginatedResponseSchema,
    paginationQuerySchema
} from '../lib/pagination'
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

  const conversationSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    phone: z.string(),
    lastMessage: z.string().nullable(),
    updatedAt: z.string()
  })

  const messageSchema = z.object({
    id: z.string(),
    role: z.string(),
    content: z.string(),
    createdAt: z.string()
  })

  // ---------------------------------------------------------------------------
  // GET /crm/conversations - Listar Conversas Ativas (Paginado)
  // ---------------------------------------------------------------------------
  app.get('/crm/conversations', {
    schema: {
      tags: ['CRM / Monitoramento'],
      summary: 'Listar Conversas',
      description: 'Retorna lista paginada de clientes com conversas recentes, ordenados por última mensagem.',
      security: [{ bearerAuth: [] }],
      querystring: paginationQuerySchema,
      response: {
        200: paginatedResponseSchema(conversationSchema)
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const { page, limit } = req.query as { page: number, limit: number }
    const skip = getSkip(page, limit)

    // Conta total de clientes com mensagens
    const totalResult = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::int as count
      FROM "Customer" c
      WHERE c."tenantId" = ${tenantId}
        AND EXISTS (SELECT 1 FROM "Message" m WHERE m."customerId" = c.id)
    `
    const total = Number(totalResult[0]?.count || 0)

    // Query paginada ordenada por última mensagem
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
      LIMIT ${limit} OFFSET ${skip}
    `

    const data = conversations.map(c => ({
      id: c.id,
      name: c.name || 'Desconhecido',
      phone: c.phone,
      lastMessage: c.lastMessage || '',
      updatedAt: c.lastMessageAt?.toISOString() || new Date().toISOString()
    }))

    return buildPaginatedResponse(data, total, page, limit)
  })

  // ---------------------------------------------------------------------------
  // GET /crm/conversations/:customerId/messages - Histórico de Chat (Paginado)
  // ---------------------------------------------------------------------------
  app.get('/crm/conversations/:customerId/messages', {
    schema: {
      tags: ['CRM / Monitoramento'],
      summary: 'Histórico de Mensagens',
      description: 'Recupera o chat paginado entre a IA e o cliente.',
      security: [{ bearerAuth: [] }],
      params: z.object({ customerId: z.string().uuid() }),
      querystring: paginationQuerySchema,
      response: {
        200: paginatedResponseSchema(messageSchema)
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const { customerId } = req.params
    const { page, limit } = req.query as { page: number, limit: number }

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { tenantId, customerId },
        orderBy: { createdAt: 'asc' },
        skip: getSkip(page, limit),
        take: limit
      }),
      prisma.message.count({ where: { tenantId, customerId } })
    ])

    const data = messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString()
    }))

    return buildPaginatedResponse(data, total, page, limit)
  })
}