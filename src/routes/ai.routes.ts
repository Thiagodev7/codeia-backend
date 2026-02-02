import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { AIService } from '../services/ai.service'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { Errors } from '../lib/errors'

/**
 * Definição das Rotas de IA
 * Gerencia todos os endpoints relacionados à configuração de Agentes e simulação de chat.
 */
export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  // Middleware de Segurança: Garante que o usuário está autenticado para todas as rotas
  app.addHook('onRequest', async (request) => {
    try {
      await request.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido ou não fornecido')
    }
  })

  const aiService = new AIService()

  // ---------------------------------------------------------------------------
  // GET /agents - Listar Agentes
  // ---------------------------------------------------------------------------
  app.get(
    '/agents',
    {
      schema: {
        tags: ['Agentes IA'],
        summary: 'Listar Agentes',
        description: 'Recupera a lista de todos os agentes configurados para a empresa atual.',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              slug: z.string(),
              instructions: z.string(),
              isActive: z.boolean(),
            })
          ),
        },
      },
    },
    async (req) => {
      const { tenantId } = req.user as { tenantId: string }
      return prisma.agent.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })
    }
  )

  // ---------------------------------------------------------------------------
  // POST /agents - Criar Agente
  // ---------------------------------------------------------------------------
  app.post(
    '/agents',
    {
      schema: {
        tags: ['Agentes IA'],
        summary: 'Criar Agente',
        description: 'Cria um novo agente de IA com instruções específicas (persona).',
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(1, 'O nome é obrigatório'),
          slug: z
            .string()
            .min(1, 'O slug é obrigatório')
            .regex(/^[a-z0-9-]+$/, 'O slug deve ser kebab-case (ex: vendas-auto)'),
          instructions: z.string().min(10, 'As instruções devem ser detalhadas (min 10 chars)'),
        }),
        response: {
          201: z.object({
            id: z.string(),
            name: z.string(),
            slug: z.string(),
            isActive: z.boolean(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const agent = await aiService.createAgent(tenantId, req.body)
      return reply.status(201).send(agent)
    }
  )

  // ---------------------------------------------------------------------------
  // PUT /agents/:id - Atualizar Agente
  // ---------------------------------------------------------------------------
  app.put(
    '/agents/:id',
    {
      schema: {
        tags: ['Agentes IA'],
        summary: 'Atualizar Agente',
        description: 'Atualiza detalhes de um agente existente. Também usado para pausar/ativar.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().optional(),
          slug: z.string().optional(),
          instructions: z.string().optional(),
          isActive: z.boolean().optional(),
        }),
        response: {
          200: z.object({
            id: z.string(),
            name: z.string(),
            isActive: z.boolean(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { id } = req.params

      logger.info({ agentId: id, changes: req.body }, '🛠️ [API] Solicitando atualização de agente')

      const updated = await aiService.updateAgent(tenantId, id, req.body)

      return reply.send(updated)
    }
  )

  // ---------------------------------------------------------------------------
  // DELETE /agents/:id - Excluir Agente
  // ---------------------------------------------------------------------------
  app.delete(
    '/agents/:id',
    {
      schema: {
        tags: ['Agentes IA'],
        summary: 'Excluir Agente',
        description: 'Remove permanentemente um agente de IA.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: z.null(),
        },
      },
    },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { id } = req.params
      await aiService.deleteAgent(tenantId, id)
      return reply.status(204).send()
    }
  )

  // ---------------------------------------------------------------------------
  // POST /chat - Simular Conversa (Endpoint de Teste)
  // ---------------------------------------------------------------------------
  app.post(
    '/chat',
    {
      schema: {
        tags: ['Agentes IA'],
        summary: 'Simulador de Chat',
        description:
          'Testa a lógica de resposta do agente sem usar o WhatsApp. Útil para debug de prompt.',
        security: [{ bearerAuth: [] }],
        body: z.object({
          agentId: z.string().uuid(),
          message: z.string().min(1),
        }),
        response: {
          200: z.object({
            response: z.string().nullable(),
            action: z.string().optional(), // Campo opcional para indicar se uma ferramenta foi chamada
          }),
        },
      },
    },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { agentId, message } = req.body

      // Nota: Usamos dados "fake" para simulação via API.
      // No fluxo real do WhatsApp, isso vem dos metadados do contato.
      const result = await aiService.chat(agentId, message, {
        tenantId,
        customerId: 'TEST_API_USER_ID',
        customerPhone: '99999999999',
        customerName: 'Tester API',
      })

      if (result.response === null) {
        return reply.send({ response: '[SISTEMA]: O agente está pausado ou indisponível.' })
      }

      return reply.send(result)
    }
  )
}
