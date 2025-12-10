import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { AIService } from '../services/ai.service'
import { prisma } from '../lib/prisma'

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => await req.jwtVerify())
  const aiService = new AIService()

  // 1. LISTAR
  app.get('/agents', {
    schema: {
      tags: ['AI Agents'],
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          instructions: z.string(),
          isActive: z.boolean() // Novo campo
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return prisma.agent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' }
    })
  })

  // 2. CRIAR
  app.post('/agents', {
    schema: {
      tags: ['AI Agents'],
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string(),
        slug: z.string(),
        instructions: z.string()
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const agent = await aiService.createAgent(tenantId, req.body)
    return reply.status(201).send(agent)
  })

  // 3. ATUALIZAR (Editar ou Pausar)
  app.put('/agents/:id', {
    schema: {
      tags: ['AI Agents'],
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string() }),
      body: z.object({
        name: z.string().optional(),
        slug: z.string().optional(),
        instructions: z.string().optional(),
        isActive: z.boolean().optional()
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params
    const updated = await aiService.updateAgent(tenantId, id, req.body)
    return reply.send(updated)
  })

  // 4. DELETAR
  app.delete('/agents/:id', {
    schema: {
      tags: ['AI Agents'],
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string() })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params
    await aiService.deleteAgent(tenantId, id)
    return reply.status(204).send()
  })

  // 5. TESTAR CHAT
  app.post('/chat', {
    schema: {
      tags: ['AI Agents'],
      security: [{ bearerAuth: [] }],
      body: z.object({
        agentId: z.string(),
        message: z.string()
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { agentId, message } = req.body
    const result = await aiService.chat(agentId, message, { tenantId, customerId: 'TEST_PANEL' })
    
    // Se estiver pausado, retorna aviso no teste
    if (result.response === null) {
        return reply.send({ response: "[SISTEMA]: Este agente está pausado e não responderá." })
    }
    return reply.send(result)
  })
}