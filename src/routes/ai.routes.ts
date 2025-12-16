import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { AIService } from '../services/ai.service'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  
  app.addHook('onRequest', async (request) => {
    try {
      await request.jwtVerify()
    } catch (err) {
      throw new Error('Token inválido ou não fornecido')
    }
  })

  const aiService = new AIService()

  // LISTAR
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
          isActive: z.boolean()
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

  // CRIAR
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

  // --- ATUALIZAR (PAUSAR/EDITAR) ---
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
    
    // LOG DE DEBUG DO UPDATE
    logger.info({ agentId: id, changes: req.body }, '🛠️ [API] Solicitando atualização de agente')

    const updated = await aiService.updateAgent(tenantId, id, req.body)
    
    logger.info({ active: updated.isActive }, '✅ [DB] Agente atualizado com sucesso.')
    
    return reply.send(updated)
  })

  // DELETAR
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

  // CHAT (TESTE)
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
    
    const result = await aiService.chat(agentId, message, { 
      tenantId, 
      customerId: 'TEST_API_USER' 
    })
    
    if (result.response === null) {
        return reply.send({ response: "[SISTEMA]: O agente está pausado e não respondeu." })
    }
    
    return reply.send(result)
  })
}