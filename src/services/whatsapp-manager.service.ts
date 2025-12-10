import { Client, LocalAuth } from 'whatsapp-web.js'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AIService } from './ai.service'

export class WhatsAppManager {
  private static instance: WhatsAppManager
  private clients: Map<string, Client> = new Map()
  private aiService = new AIService()

  private constructor() {}

  public static getInstance(): WhatsAppManager {
    if (!WhatsAppManager.instance) {
      WhatsAppManager.instance = new WhatsAppManager()
    }
    return WhatsAppManager.instance
  }

  async startClient(tenantId: string) {
    if (this.clients.has(tenantId)) return

    logger.info({ tenantId }, 'Iniciando cliente WhatsApp...')

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: tenantId }),
      puppeteer: { 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
      }
    })

    client.on('qr', async (qr) => {
      logger.info({ tenantId }, 'Novo QR Code gerado! (Verifique logs para string)')
      // Aqui você emitiria esse QR via WebSocket para o Frontend
      await prisma.whatsAppSession.upsert({
        where: { tenantId },
        create: { tenantId, sessionName: 'Main', status: 'QRCODE' },
        update: { status: 'QRCODE' }
      })
    })

    client.on('ready', async () => {
      logger.info({ tenantId }, 'WhatsApp conectado!')
      await prisma.whatsAppSession.update({
        where: { tenantId },
        data: { status: 'CONNECTED' }
      })
    })

    // Lógica de Recebimento de Mensagens
    client.on('message', async (msg) => {
      if (msg.from.includes('@g.us') || msg.from === 'status@broadcast') return

      const contact = await msg.getContact()
      const phone = contact.number

      try {
        // 1. Identifica Cliente
        let customer = await prisma.customer.findUnique({
            where: { tenantId_phone: { tenantId, phone } }
        })

        if (!customer) {
          customer = await prisma.customer.create({
            data: { tenantId, phone, name: contact.pushname || 'Unknown' }
          })
        }

        // 2. Salva Mensagem User
        await prisma.message.create({
          data: { tenantId, customerId: customer.id, role: 'user', content: msg.body }
        })

        // 3. Busca Agente Ativo
        const agent = await prisma.agent.findFirst({ where: { tenantId, isActive: true } })

        if (agent) {
          // 4. Gera Resposta com IA
          const aiRes = await this.aiService.chat(agent.id, msg.body)
          
          // 5. Responde no Zap
          await msg.reply(aiRes.response)

          // 6. Salva Resposta Bot
          await prisma.message.create({
            data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
          })
        }
      } catch (err) {
        logger.error({ err }, 'Erro processando mensagem')
      }
    })

    await client.initialize()
    this.clients.set(tenantId, client)
  }
}