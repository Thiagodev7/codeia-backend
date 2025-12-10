import { Client, LocalAuth } from 'whatsapp-web.js'
import * as QRCode from 'qrcode'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AIService } from './ai.service'

interface SessionInfo {
  status: string
  qrCode: string | null
  phoneNumber: string | null
}

export class WhatsAppManager {
  private static instance: WhatsAppManager
  private clients: Map<string, Client> = new Map()
  private sessions: Map<string, SessionInfo> = new Map()
  private aiService = new AIService()

  private constructor() {}

  public static getInstance(): WhatsAppManager {
    if (!WhatsAppManager.instance) {
      WhatsAppManager.instance = new WhatsAppManager()
    }
    return WhatsAppManager.instance
  }

  getStatus(tenantId: string): SessionInfo {
    const session = this.sessions.get(tenantId)
    if (!session) {
      return { status: 'DISCONNECTED', qrCode: null, phoneNumber: null }
    }
    return session
  }

  async startClient(tenantId: string) {
    if (this.clients.has(tenantId)) return

    logger.info({ tenantId }, 'Iniciando cliente WhatsApp...')
    
    this.sessions.set(tenantId, { status: 'STARTING', qrCode: null, phoneNumber: null })

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: tenantId }),
      puppeteer: { 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
      }
    })

    client.on('qr', async (qr) => {
      logger.info({ tenantId }, 'QR Code Gerado')
      const qrImage = await QRCode.toDataURL(qr)
      
      this.sessions.set(tenantId, { 
        status: 'QRCODE', 
        qrCode: qrImage, 
        phoneNumber: null 
      })

      await prisma.whatsAppSession.upsert({
        where: { tenantId },
        create: { tenantId, status: 'QRCODE' },
        update: { status: 'QRCODE' }
      })
    })

    client.on('ready', async () => {
      const phoneNumber = client.info.wid.user
      logger.info({ tenantId, phoneNumber }, 'WhatsApp Conectado!')

      this.sessions.set(tenantId, { 
        status: 'CONNECTED', 
        qrCode: null, 
        phoneNumber: phoneNumber 
      })

      await prisma.whatsAppSession.update({
        where: { tenantId },
        data: { status: 'CONNECTED' }
      })
    })

    client.on('disconnected', async (reason) => {
      logger.warn({ tenantId, reason }, 'WhatsApp Desconectado')
      this.clients.delete(tenantId)
      this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
      
      await prisma.whatsAppSession.update({
        where: { tenantId },
        data: { status: 'DISCONNECTED' }
      })
    })

    client.on('message', async (msg) => {
      if (msg.from.includes('@g.us') || msg.from === 'status@broadcast') return
      
      try {
        const contact = await msg.getContact()
        const phone = contact.number

        // 1. Identifica ou Cria o Cliente (Customer)
        let customer = await prisma.customer.findUnique({
            where: { tenantId_phone: { tenantId, phone } }
        })

        if (!customer) {
          customer = await prisma.customer.create({
            data: { tenantId, phone, name: contact.pushname || 'Unknown' }
          })
        }

        // 2. Salva Mensagem do Usuário
        await prisma.message.create({
          data: { tenantId, customerId: customer.id, role: 'user', content: msg.body }
        })

        // 3. Busca o Agente Ativo da Empresa
        const agent = await prisma.agent.findFirst({ where: { tenantId, isActive: true } })

        if (agent) {
          // 4. Chama a IA passando o CONTEXTO (Isso é crucial para o agendamento)
          const aiRes = await this.aiService.chat(
            agent.id, 
            msg.body, 
            { tenantId, customerId: customer.id } // <--- Contexto injetado aqui
          )
          
          // 5. Responde no WhatsApp
          await msg.reply(aiRes.response)

          // 6. Salva a resposta da IA no histórico
          await prisma.message.create({
            data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
          })
        }
      } catch (err) {
        logger.error({ err }, 'Erro processando mensagem')
      }
    })

    try {
        await client.initialize()
        this.clients.set(tenantId, client)
    } catch (error) {
        logger.error({error}, 'Falha ao inicializar cliente')
        this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
    }
  }

  async stopClient(tenantId: string) {
    const client = this.clients.get(tenantId)
    if (client) {
        try {
            await client.destroy()
        } catch (e) {
            logger.error('Erro ao destruir sessão', e)
        }
        this.clients.delete(tenantId)
    }
    this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
    
    await prisma.whatsAppSession.update({
        where: { tenantId },
        data: { status: 'DISCONNECTED' }
    })
  }
}