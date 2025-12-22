import { Client, LocalAuth } from 'whatsapp-web.js'
import * as QRCode from 'qrcode'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AIService } from './ai.service'
import { Content } from '@google/generative-ai'
import { asyncContext } from '../lib/async-context'
import { randomUUID } from 'node:crypto'

interface SessionInfo {
  status: string
  qrCode: string | null
  phoneNumber: string | null
  sessionName: string
}

export class WhatsAppManager {
  private static instance: WhatsAppManager
  
  private clients: Map<string, Client> = new Map()
  private sessions: Map<string, SessionInfo> = new Map()
  private qrTimeouts: Map<string, NodeJS.Timeout> = new Map()
  
  private aiService = new AIService()
  private readonly QR_TIMEOUT_MS = 120 * 1000; 

  private constructor() {}

  public static getInstance(): WhatsAppManager {
    if (!WhatsAppManager.instance) {
      WhatsAppManager.instance = new WhatsAppManager()
    }
    return WhatsAppManager.instance
  }

  getSessionStatus(sessionId: string): SessionInfo {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName: '' }
    }
    return session
  }

  async startClient(tenantId: string, sessionId: string, sessionName: string, linkedAgentId?: string | null) {
    // Evita duplicidade se já estiver rodando
    if (this.clients.has(sessionId)) {
        logger.info({ tenantId, sessionId }, '⚠️ [WhatsApp] Sessão já ativa.')
        return
    }

    logger.info({ tenantId, sessionId }, `🔄 [WhatsApp] Iniciando sessão: ${sessionName}`)
    
    // Marca como iniciando na memória
    this.sessions.set(sessionId, { 
        status: 'STARTING', 
        qrCode: null, 
        phoneNumber: null,
        sessionName 
    })

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionId }),
      puppeteer: { 
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ] 
      }
    })

    // Adicionamos o cliente ao mapa ANTES de inicializar para podermos matá-lo se a sessão for deletada durante o boot
    this.clients.set(sessionId, client)

    // --- EVENTOS ---

    client.on('qr', async (qr) => {
      logger.info({ tenantId, sessionId }, '📱 [WhatsApp] QR Code gerado.')
      const qrImage = await QRCode.toDataURL(qr)
      
      this.sessions.set(sessionId, { 
          status: 'QRCODE', 
          qrCode: qrImage, 
          phoneNumber: null,
          sessionName 
      })

      try {
        await prisma.whatsAppSession.update({
          where: { id: sessionId },
          data: { status: 'QRCODE' }
        })
      } catch (error: any) {
        // Se o registro não existe mais (foi deletado), matamos o processo
        if (error.code === 'P2025') {
            logger.warn({ sessionId }, '⚠️ Sessão não encontrada no banco (Deletada?). Encerrando cliente.')
            await this.stopClient(sessionId)
            return
        }
        logger.error({ error }, '❌ Erro ao atualizar QR Code no banco')
      }

      // Timeout do QR Code
      if (!this.qrTimeouts.has(sessionId)) {
          const timeout = setTimeout(async () => {
              logger.warn({ sessionId }, '⏰ [WhatsApp] Timeout QR Code.')
              await this.stopClient(sessionId)
          }, this.QR_TIMEOUT_MS)
          this.qrTimeouts.set(sessionId, timeout)
      }
    })

    client.on('ready', async () => {
      this.clearQrTimeout(sessionId)
      const phoneNumber = client.info.wid.user
      logger.info({ tenantId, sessionId, phoneNumber }, '✅ [WhatsApp] Conectado!')

      this.sessions.set(sessionId, { 
          status: 'CONNECTED', 
          qrCode: null, 
          phoneNumber: phoneNumber,
          sessionName
      })

      try {
        await prisma.whatsAppSession.update({
            where: { id: sessionId },
            data: { status: 'CONNECTED' }
        })
      } catch (error: any) {
        if (error.code === 'P2025') {
            await this.stopClient(sessionId)
        }
      }
    })

    client.on('auth_failure', async () => {
        logger.error({ sessionId }, '❌ [WhatsApp] Falha Auth.')
        this.clearQrTimeout(sessionId)
        await this.stopClient(sessionId)
    })

    client.on('disconnected', async (reason) => {
      logger.warn({ sessionId, reason }, '❌ [WhatsApp] Desconectado.')
      this.clearQrTimeout(sessionId)
      
      // Remove do mapa de clientes ativos
      this.clients.delete(sessionId)
      
      this.sessions.set(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName })
      
      try {
        await prisma.whatsAppSession.update({
            where: { id: sessionId },
            data: { status: 'DISCONNECTED' }
        })
      } catch (error: any) {
         // Ignora erro se já foi deletado
      }
    })

    // --- LÓGICA DE MENSAGENS ---

    client.on('message', async (msg) => {
      if (msg.from.includes('@g.us') || msg.from === 'status@broadcast' || msg.id.remote.includes('broadcast')) return

      const requestId = `wa-${randomUUID().split('-')[0]}`
      
      asyncContext.run({ requestId, tenantId, path: 'whatsapp-event' }, async () => {
          try {
            let phone = msg.from.replace('@c.us', '');
            let contactName = 'Cliente';
            try {
                const contact = await msg.getContact();
                phone = contact.number;
                contactName = contact.pushname || contact.name || 'Cliente';
            } catch (e) {}

            logger.info({ from: phone, session: sessionName }, '📥 [WhatsApp] Recebido')

            let customer = await prisma.customer.findUnique({
                where: { tenantId_phone: { tenantId, phone } }
            })

            if (!customer) {
              customer = await prisma.customer.create({
                data: { tenantId, phone, name: contactName }
              })
            }

            await prisma.message.create({
              data: { tenantId, customerId: customer.id, role: 'user', content: msg.body }
            })

            // Roteamento de Agente
            let agentIdToUse = linkedAgentId;
            if (!agentIdToUse) {
                const anyAgent = await prisma.agent.findFirst({ where: { tenantId, isActive: true } })
                agentIdToUse = anyAgent?.id
            }

            if (!agentIdToUse) return

            const previousMessages = await prisma.message.findMany({
                where: { tenantId, customerId: customer.id },
                orderBy: { createdAt: 'desc' },
                take: 20 
            })
            let rawHistory = previousMessages.reverse();
            rawHistory = rawHistory.filter(m => m.content !== msg.body);
            while (rawHistory.length > 0 && rawHistory[0].role === 'model') rawHistory.shift(); 

            const history: Content[] = rawHistory.map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }))

            logger.info({ agentId: agentIdToUse }, '🤖 [IA] Respondendo...')
            const aiRes = await this.aiService.chat(
                agentIdToUse, 
                msg.body, 
                { tenantId, customerId: customer.id, customerPhone: phone, customerName: contactName },
                history
            )
            
            if (aiRes.response) {
                await msg.reply(aiRes.response)
                await prisma.message.create({
                  data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
                })
            }

          } catch (err: any) {
            logger.error({ err: err.message }, '❌ [WhatsApp] Erro message handler')
          }
      })
    })

    // Inicialização
    try {
        await client.initialize()
    } catch (error) {
        logger.error({ error, sessionId }, '💀 [WhatsApp] Falha Puppeteer')
        this.clearQrTimeout(sessionId)
        this.sessions.set(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName })
        this.clients.delete(sessionId) // Limpa se falhar
    }
  }

  async stopClient(sessionId: string) {
    logger.info({ sessionId }, '🛑 [WhatsApp] Parando sessão...')
    this.clearQrTimeout(sessionId)

    const client = this.clients.get(sessionId)
    if (client) {
        try {
            await client.destroy()
        } catch (e) {
            logger.warn({ sessionId }, 'Erro ao destruir cliente (pode já estar fechado).')
        }
        this.clients.delete(sessionId)
    }
    
    // Atualiza memória
    const oldSession = this.sessions.get(sessionId)
    this.sessions.set(sessionId, { 
        status: 'DISCONNECTED', 
        qrCode: null, 
        phoneNumber: null, 
        sessionName: oldSession?.sessionName || 'Sessão' 
    })
    
    // Atualiza banco (com try/catch caso tenha sido deletado)
    try {
        await prisma.whatsAppSession.update({ where: { id: sessionId }, data: { status: 'DISCONNECTED' } })
    } catch (e) {
        // Ignora erro P2025 aqui, pois se foi deletado, tudo bem.
    }
  }

  private clearQrTimeout(sessionId: string) {
      if (this.qrTimeouts.has(sessionId)) {
          clearTimeout(this.qrTimeouts.get(sessionId))
          this.qrTimeouts.delete(sessionId)
      }
  }
}