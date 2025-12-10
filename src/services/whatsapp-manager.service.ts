import { Client, LocalAuth } from 'whatsapp-web.js'
import * as QRCode from 'qrcode'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AIService } from './ai.service'
import { Content } from '@google/generative-ai'

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

    // --- LÓGICA DE MENSAGENS BLINDADA ---
    client.on('message', async (msg) => {
      // 1. Filtros de Segurança (Ignora Grupos e Broadcasts)
      if (
        msg.from.includes('@g.us') ||       
        msg.from === 'status@broadcast' ||  
        msg.id.remote.includes('broadcast') 
      ) {
        return
      }

      try {
        // --- PROTEÇÃO CONTRA ERRO "getIsMyContact" ---
        let phone = msg.from.replace('@c.us', '');
        let contactName = 'Cliente';

        try {
            const contact = await msg.getContact();
            phone = contact.number;
            contactName = contact.pushname || contact.name || 'Cliente';
        } catch (contactError) {
            logger.warn(`Falha ao obter dados do contato para ${msg.from}. Usando fallback.`);
        }
        // ---------------------------------------------

        // 2. Identifica ou Cria Cliente
        let customer = await prisma.customer.findUnique({
            where: { tenantId_phone: { tenantId, phone } }
        })

        if (!customer) {
          customer = await prisma.customer.create({
            data: { tenantId, phone, name: contactName }
          })
        }

        // 3. Salva Mensagem do Usuário
        await prisma.message.create({
          data: { tenantId, customerId: customer.id, role: 'user', content: msg.body }
        })

        // 4. Busca Agente Ativo (Pega o primeiro ativo)
        const agent = await prisma.agent.findFirst({ where: { tenantId, isActive: true } })

        if (agent) {
          logger.info(`🤖 [${agent.name}] Respondendo ${phone}...`)

          // 5. Histórico (Memória)
          const previousMessages = await prisma.message.findMany({
            where: { tenantId, customerId: customer.id },
            orderBy: { createdAt: 'desc' },
            take: 20 
          })

          // Formata para o Gemini (remove a msg atual para não duplicar no prompt)
          const history: Content[] = previousMessages
            .reverse()
            .filter(m => m.content !== msg.body)
            .map(m => ({
              role: m.role === 'user' ? 'user' : 'model',
              parts: [{ text: m.content }]
            }))

          // 6. Chama a IA
          const aiRes = await this.aiService.chat(
            agent.id, 
            msg.body, 
            { tenantId, customerId: customer.id },
            history
          )
          
          // Se a IA não retornou null (não estava pausada)
          if (aiRes.response) {
            await msg.reply(aiRes.response)

            // 7. Salva Resposta
            await prisma.message.create({
              data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
            })
          }
        }
      } catch (err) {
        logger.error({ err }, 'Erro crítico processando mensagem')
      }
    })

    try {
        await client.initialize()
        this.clients.set(tenantId, client)
    } catch (error) {
        logger.error({error}, 'Falha fatal ao inicializar cliente')
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