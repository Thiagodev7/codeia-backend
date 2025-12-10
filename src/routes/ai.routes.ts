import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { AIService } from '../services/ai.service'
import { prisma } from '../lib/prisma' // <--- Importante: Adicione o prisma aqui

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  
  // Middleware de Segurança
  app.addHook('onRequest', async (request) => {
    try {
      await request.jwtVerify()
    } catch (err) {
      throw new Error('Token inválido ou não fornecido')
    }
  })

  const aiService = new AIService()

  // --- 1. LISTAR AGENTES (Faltava isso!) ---
  app.get('/agents', {
    schema: {
      tags: ['AI Agents'],
      summary: 'Listar todos os agentes da empresa',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          instructions: z.string()
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    
    // Busca no banco todos os agentes desta empresa
    return prisma.agent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' }
    })
  })

  // --- 2. CRIAR AGENTE ---
  app.post('/agents', {
    schema: {
      tags: ['AI Agents'],
      summary: 'Criar um novo Agente de IA',
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string(),
        slug: z.string(),
        instructions: z.string()
      }),
      response: {
        201: z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string()
        })
      }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const agent = await aiService.createAgent(tenantId, req.body)
    return reply.status(201).send(agent)
  })

  // --- 3. TESTAR CHAT (Via API/Painel) ---
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
    
    // Contexto de teste
    const result = await aiService.chat(agentId, message, { 
      tenantId, 
      customerId: 'TEST_PANEL_USER' 
    })
    return reply.send(result)
  })
}