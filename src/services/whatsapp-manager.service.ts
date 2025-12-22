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
  sessionName: string // Adicionado para identificar visualmente
}

export class WhatsAppManager {
  private static instance: WhatsAppManager
  
  // A chave agora é o SESSION_ID, não mais o TenantId
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

  // Busca status de UMA sessão específica
  getSessionStatus(sessionId: string): SessionInfo {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName: '' }
    }
    return session
  }

  // Lista todos os status de um Tenant
  getAllStatuses(tenantId: string): Record<string, SessionInfo> {
    const result: Record<string, SessionInfo> = {}
    // Filtra as sessões que pertencem a este tenant
    // Nota: Em produção, idealmente teríamos um mapa reverso tenantId -> [sessionIds], 
    // mas por enquanto iterar funciona para MVP.
    // Para simplificar, o controller vai buscar do banco e pedir o status individualmente, 
    // ou mantemos em memória. Vamos focar no startClient.
    return result; 
  }

  async startClient(tenantId: string, sessionId: string, sessionName: string, linkedAgentId?: string | null) {
    // A chave do mapa é o SessionID para suportar múltiplos números
    if (this.clients.has(sessionId)) {
        logger.info({ tenantId, sessionId }, '⚠️ [WhatsApp] Sessão já ativa.')
        return
    }

    logger.info({ tenantId, sessionId }, `🔄 [WhatsApp] Iniciando sessão: ${sessionName}`)
    
    this.sessions.set(sessionId, { 
        status: 'STARTING', 
        qrCode: null, 
        phoneNumber: null,
        sessionName 
    })

    const client = new Client({
      // IMPORTANTE: clientId deve ser único por sessão para criar pastas diferentes (.wwebjs_auth/session-UUID)
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

      await prisma.whatsAppSession.update({
        where: { id: sessionId },
        data: { status: 'QRCODE' }
      })

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

      await prisma.whatsAppSession.update({
        where: { id: sessionId },
        data: { status: 'CONNECTED' }
      })
    })

    client.on('auth_failure', async () => {
        logger.error({ sessionId }, '❌ [WhatsApp] Falha Auth.')
        this.clearQrTimeout(sessionId)
        await this.stopClient(sessionId)
    })

    client.on('disconnected', async (reason) => {
      logger.warn({ sessionId, reason }, '❌ [WhatsApp] Desconectado.')
      this.clearQrTimeout(sessionId)
      this.clients.delete(sessionId)
      this.sessions.set(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName })
      
      await prisma.whatsAppSession.update({
        where: { id: sessionId },
        data: { status: 'DISCONNECTED' }
      })
    })

    // --- LÓGICA DE MENSAGENS ---

    client.on('message', async (msg) => {
      if (msg.from.includes('@g.us') || msg.from === 'status@broadcast' || msg.id.remote.includes('broadcast')) return

      const requestId = `wa-${randomUUID().split('-')[0]}`
      
      asyncContext.run({ requestId, tenantId, path: 'whatsapp-event' }, async () => {
          try {
            // ... (Lógica de extração de contato igual ao anterior) ...
            let phone = msg.from.replace('@c.us', '');
            let contactName = 'Cliente';
            try {
                const contact = await msg.getContact();
                phone = contact.number;
                contactName = contact.pushname || contact.name || 'Cliente';
            } catch (e) {}

            logger.info({ from: phone, session: sessionName }, '📥 [WhatsApp] Recebido')

            // 1. Identificação do Cliente
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

            // 2. SELEÇÃO DO AGENTE (A Mágica acontece aqui)
            // Se a sessão tem um agente vinculado, usa ele. Se não, tenta pegar o padrão.
            let agentIdToUse = linkedAgentId;

            if (!agentIdToUse) {
                // Fallback: Pega qualquer agente ativo se a sessão não tiver um específico
                const anyAgent = await prisma.agent.findFirst({ where: { tenantId, isActive: true } })
                agentIdToUse = anyAgent?.id
            }

            if (!agentIdToUse) {
                logger.debug('⛔ [IA] Nenhum agente configurado para esta sessão ou tenant.')
                return
            }

            // ... (Lógica de Histórico e Chamada IA igual ao anterior) ...
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
                agentIdToUse, // <--- USA O AGENTE DA SESSÃO
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
        this.clients.set(sessionId, client) // Mapa agora usa sessionId
    } catch (error) {
        logger.error({ error, sessionId }, '💀 [WhatsApp] Falha Puppeteer')
        this.clearQrTimeout(sessionId)
        this.sessions.set(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName })
    }
  }

  async stopClient(sessionId: string) {
    logger.info({ sessionId }, '🛑 [WhatsApp] Parando sessão...')
    this.clearQrTimeout(sessionId)

    const client = this.clients.get(sessionId)
    if (client) {
        try {
            await client.destroy()
        } catch (e) {}
        this.clients.delete(sessionId)
    }
    
    // Mantemos o nome da sessão no status desconectado para a UI não ficar vazia
    const oldSession = this.sessions.get(sessionId)
    this.sessions.set(sessionId, { 
        status: 'DISCONNECTED', 
        qrCode: null, 
        phoneNumber: null, 
        sessionName: oldSession?.sessionName || 'Sessão' 
    })
    
    await prisma.whatsAppSession.update({ where: { id: sessionId }, data: { status: 'DISCONNECTED' } })
  }

  private clearQrTimeout(sessionId: string) {
      if (this.qrTimeouts.has(sessionId)) {
          clearTimeout(this.qrTimeouts.get(sessionId))
          this.qrTimeouts.delete(sessionId)
      }
  }
}