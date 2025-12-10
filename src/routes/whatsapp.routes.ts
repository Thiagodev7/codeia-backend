import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { WhatsAppManager } from '../services/whatsapp-manager.service'

export const whatsappRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => await req.jwtVerify())

  app.post('/whatsapp/connect', {
    schema: {
      tags: ['WhatsApp'],
      summary: 'Iniciar Bot para a Empresa Logada',
      security: [{ bearerAuth: [] }],
      response: { 200: z.object({ message: z.string() }) }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const manager = WhatsAppManager.getInstance()
    
    manager.startClient(tenantId)

    return reply.send({ message: 'Iniciando WhatsApp. Verifique o servidor para ler o QR Code.' })
  })
}