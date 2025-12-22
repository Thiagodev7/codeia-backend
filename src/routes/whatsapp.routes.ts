import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { WhatsAppManager } from '../services/whatsapp-manager.service'
import { prisma } from '../lib/prisma'
import { Errors } from '../lib/errors'

export const whatsappRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => await req.jwtVerify())

  const manager = WhatsAppManager.getInstance()

  // Helper para limites do plano
  const getPlanLimit = (plan: string) => {
    switch(plan.toUpperCase()) {
        case 'BASIC': return 1;
        case 'SECONDARY': return 2;
        case 'THIRD': return 5;
        case 'UNLIMITED': return 99;
        default: return 1; // Free/Default
    }
  }

  // ---------------------------------------------------------------------------
  // GET /whatsapp/sessions - Listar todas as sessões
  // ---------------------------------------------------------------------------
  app.get('/whatsapp/sessions', {
    schema: {
      tags: ['WhatsApp Multi-Session'],
      summary: 'Listar Sessões',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          sessionName: z.string(),
          status: z.string(),
          agent: z.object({ name: z.string() }).nullable().optional(),
          qrCode: z.string().nullable(), // Vindo da memória do Manager
          phoneNumber: z.string().nullable()
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    
    // Busca do banco
    const dbSessions = await prisma.whatsAppSession.findMany({
        where: { tenantId },
        include: { agent: { select: { name: true } } }
    })

    // Mescla com status em tempo real do Manager (QR Code, etc)
    return dbSessions.map(s => {
        const realtime = manager.getSessionStatus(s.id)
        return {
            id: s.id,
            sessionName: s.sessionName,
            status: realtime.status !== 'DISCONNECTED' ? realtime.status : s.status,
            agent: s.agent,
            qrCode: realtime.qrCode,
            phoneNumber: realtime.phoneNumber
        }
    })
  })

  // ---------------------------------------------------------------------------
  // POST /whatsapp/sessions - Criar Nova Sessão (Com Validação de Plano)
  // ---------------------------------------------------------------------------
  app.post('/whatsapp/sessions', {
    schema: {
      tags: ['WhatsApp Multi-Session'],
      summary: 'Criar Nova Sessão',
      security: [{ bearerAuth: [] }],
      body: z.object({
        sessionName: z.string().min(3),
        agentId: z.string().uuid().optional() // Opcional: Vincular agente na criação
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { sessionName, agentId } = req.body

    // 1. Verificar Limites do Plano
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    const currentCount = await prisma.whatsAppSession.count({ where: { tenantId } })
    const limit = getPlanLimit(tenant?.plan || 'FREE')

    if (currentCount >= limit) {
        throw Errors.Forbidden(`Seu plano (${tenant?.plan}) permite apenas ${limit} sessões. Faça upgrade.`)
    }

    // 2. Criar no Banco
    const session = await prisma.whatsAppSession.create({
        data: {
            tenantId,
            sessionName,
            agentId,
            status: 'DISCONNECTED'
        }
    })

    return reply.status(201).send(session)
  })

  // ---------------------------------------------------------------------------
  // POST /whatsapp/sessions/:id/start - Iniciar Conexão
  // ---------------------------------------------------------------------------
  app.post('/whatsapp/sessions/:id/start', {
    schema: {
      tags: ['WhatsApp Multi-Session'],
      summary: 'Iniciar Sessão',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params

    const session = await prisma.whatsAppSession.findFirst({ where: { id, tenantId } })
    if (!session) throw Errors.NotFound('Sessão não encontrada.')

    // Inicia o Manager com o ID da Sessão e o Agente Vinculado
    manager.startClient(tenantId, session.id, session.sessionName, session.agentId)

    return reply.send({ message: `Iniciando sessão ${session.sessionName}...` })
  })

  // ---------------------------------------------------------------------------
  // POST /whatsapp/sessions/:id/stop - Parar/Desconectar
  // ---------------------------------------------------------------------------
  app.post('/whatsapp/sessions/:id/stop', {
    schema: {
      tags: ['WhatsApp Multi-Session'],
      summary: 'Parar Sessão',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params

    // Valida propriedade
    const session = await prisma.whatsAppSession.findFirst({ where: { id, tenantId } })
    if (!session) throw Errors.NotFound('Sessão não encontrada.')

    await manager.stopClient(id)
    return reply.send({ message: 'Sessão parada.' })
  })

  // ---------------------------------------------------------------------------
  // DELETE /whatsapp/sessions/:id - Excluir do Banco
  // ---------------------------------------------------------------------------
  app.delete('/whatsapp/sessions/:id', {
    schema: {
      tags: ['WhatsApp Multi-Session'],
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params

    const session = await prisma.whatsAppSession.findFirst({ where: { id, tenantId } })
    if (!session) throw Errors.NotFound('Sessão não encontrada.')

    // Garante que para antes de deletar
    await manager.stopClient(id)
    await prisma.whatsAppSession.delete({ where: { id } })

    return reply.status(204).send()
  })
}