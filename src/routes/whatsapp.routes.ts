import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { WhatsAppManager } from '../services/whatsapp-manager.service'
import { Errors } from '../lib/errors'

/**
 * Rotas do WhatsApp
 * Gerenciamento de conexão, QR Code e Status da sessão.
 */
export const whatsappRoutes: FastifyPluginAsyncZod = async (app) => {
  
  // Segurança: Apenas usuários logados podem gerenciar o WhatsApp
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido')
    }
  })

  const manager = WhatsAppManager.getInstance()

  // ---------------------------------------------------------------------------
  // POST /whatsapp/connect - Iniciar Sessão
  // ---------------------------------------------------------------------------
  app.post('/whatsapp/connect', {
    schema: {
      tags: ['WhatsApp'],
      summary: 'Conectar WhatsApp',
      description: 'Inicia o processo de conexão. Gera um QR Code se não estiver conectado.',
      security: [{ bearerAuth: [] }],
      response: { 200: z.object({ message: z.string() }) }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    manager.startClient(tenantId)
    return reply.send({ message: 'Processo de conexão iniciado. Verifique o status.' })
  })

  // ---------------------------------------------------------------------------
  // GET /whatsapp/status - Verificar Status (Polling)
  // ---------------------------------------------------------------------------
  app.get('/whatsapp/status', {
    schema: {
      tags: ['WhatsApp'],
      summary: 'Status da Conexão',
      description: 'Retorna o estado atual (CONNECTED, QRCODE, DISCONNECTED) e a imagem do QR Code se disponível.',
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

  // ---------------------------------------------------------------------------
  // POST /whatsapp/disconnect - Logout
  // ---------------------------------------------------------------------------
  app.post('/whatsapp/disconnect', {
    schema: {
      tags: ['WhatsApp'],
      summary: 'Desconectar',
      description: 'Encerra a sessão atual do WhatsApp e limpa os dados de conexão.',
      security: [{ bearerAuth: [] }],
      response: { 200: z.object({ message: z.string() }) }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    await manager.stopClient(tenantId)
    return reply.send({ message: 'Sessão desconectada com sucesso.' })
  })
}