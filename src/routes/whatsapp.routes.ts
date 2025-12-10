import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { WhatsAppManager } from '../services/whatsapp-manager.service'

export const whatsappRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => await req.jwtVerify())

  const manager = WhatsAppManager.getInstance()

  // 1. Iniciar Conexão
  app.post('/whatsapp/connect', {
    schema: {
      tags: ['WhatsApp'],
      security: [{ bearerAuth: [] }],
      response: { 200: z.object({ message: z.string() }) }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    manager.startClient(tenantId)
    return reply.send({ message: 'Iniciando WhatsApp...' })
  })

  // 2. Obter Status (Polling) - Retorna QR Code ou Status Conectado
  app.get('/whatsapp/status', {
    schema: {
      tags: ['WhatsApp'],
      security: [{ bearerAuth: [] }],
      response: { 
        200: z.object({ 
          status: z.string(),
          qrCode: z.string().nullable(),
          phoneNumber: z.string().nullable()
        }) 
      }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const status = manager.getStatus(tenantId)
    return reply.send(status)
  })

  // 3. Desconectar
  app.post('/whatsapp/disconnect', {
    schema: {
      tags: ['WhatsApp'],
      security: [{ bearerAuth: [] }],
      response: { 200: z.object({ message: z.string() }) }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    await manager.stopClient(tenantId)
    return reply.send({ message: 'Desconectado com sucesso' })
  })
}