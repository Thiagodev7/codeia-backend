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
  
  // NOVO: Gerenciador de Timeouts para evitar consumo de RAM
  private qrTimeouts: Map<string, NodeJS.Timeout> = new Map()
  
  private aiService = new AIService()

  // Configuração: Tempo máximo para ler o QR Code (2 minutos)
  private readonly QR_TIMEOUT_MS = 120 * 1000; 

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
    // Se já existe e está conectado/iniciando, não faz nada
    if (this.clients.has(tenantId)) {
        logger.info({ tenantId }, '⚠️ [WhatsApp] Cliente já está ativo. Ignorando nova solicitação.')
        return
    }

    logger.info({ tenantId }, '🔄 [WhatsApp] Alocando recursos e iniciando navegador...')
    
    this.sessions.set(tenantId, { status: 'STARTING', qrCode: null, phoneNumber: null })

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: tenantId }),
      puppeteer: { 
        headless: true,
        // Otimizações de Memória para o Puppeteer
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Evita crash em ambientes Docker/Linux com pouca memória
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ] 
      }
    })

    // --- EVENTOS DO CLIENTE ---

    client.on('qr', async (qr) => {
      logger.info({ tenantId }, '📱 [WhatsApp] QR Code gerado.')
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

      // --- LOGICA DE TIMEOUT (MEMORY LEAK PROTECTION) ---
      // Se não houver um timer rodando, inicia um.
      if (!this.qrTimeouts.has(tenantId)) {
          logger.info({ tenantId }, `⏳ [WhatsApp] Iniciando timer de expiração (${this.QR_TIMEOUT_MS / 1000}s)...`)
          
          const timeout = setTimeout(async () => {
              logger.warn({ tenantId }, '⏰ [WhatsApp] Tempo limite do QR Code excedido. Encerrando processo para liberar memória.')
              await this.stopClient(tenantId)
          }, this.QR_TIMEOUT_MS)

          this.qrTimeouts.set(tenantId, timeout)
      }
    })

    client.on('ready', async () => {
      // Limpa o timer de timeout, pois conectou com sucesso
      this.clearQrTimeout(tenantId)

      const phoneNumber = client.info.wid.user
      logger.info({ tenantId, phoneNumber }, '✅ [WhatsApp] Conectado e Pronto!')

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

    client.on('auth_failure', async () => {
        logger.error({ tenantId }, '❌ [WhatsApp] Falha na autenticação. Reiniciando sessão...')
        this.clearQrTimeout(tenantId)
        await this.stopClient(tenantId)
    })

    client.on('disconnected', async (reason) => {
      logger.warn({ tenantId, reason }, '❌ [WhatsApp] Desconectado.')
      this.clearQrTimeout(tenantId)
      
      // Remove da memória
      this.clients.delete(tenantId)
      this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
      
      await prisma.whatsAppSession.update({
        where: { tenantId },
        data: { status: 'DISCONNECTED' }
      })
    })

    // --- LÓGICA PRINCIPAL DE MENSAGENS ---

    client.on('message', async (msg) => {
      if (
        msg.from.includes('@g.us') ||       
        msg.from === 'status@broadcast' ||  
        msg.id.remote.includes('broadcast') 
      ) {
        return
      }

      const start = Date.now()
      
      try {
        let phone = msg.from.replace('@c.us', '');
        let contactName = 'Cliente';

        try {
            const contact = await msg.getContact();
            phone = contact.number;
            contactName = contact.pushname || contact.name || 'Cliente';
        } catch (contactError) {
            logger.warn({ from: msg.from }, '⚠️ [WhatsApp] Falha ao obter dados detalhados do contato.')
        }

        logger.info({ 
            tenantId, 
            from: phone, 
            name: contactName, 
            body: msg.body 
        }, '📥 [WhatsApp] Mensagem Recebida')

        let customer = await prisma.customer.findUnique({
            where: { tenantId_phone: { tenantId, phone } }
        })

        if (!customer) {
          logger.info({ phone, name: contactName }, '🆕 [CRM] Novo cliente detectado. Registrando...')
          customer = await prisma.customer.create({
            data: { tenantId, phone, name: contactName }
          })
        }

        await prisma.message.create({
          data: { tenantId, customerId: customer.id, role: 'user', content: msg.body }
        })

        const activeAgents = await prisma.agent.findMany({ 
            where: { tenantId, isActive: true } 
        })

        if (activeAgents.length === 0) {
            logger.debug({ tenantId }, '⛔ [IA] Nenhum agente ativo para responder.')
            return
        }

        const agent = activeAgents[0]
        logger.info({ agentId: agent.id, agentName: agent.name }, '🤖 [IA] Acionando Agente...')

        const previousMessages = await prisma.message.findMany({
            where: { tenantId, customerId: customer.id },
            orderBy: { createdAt: 'desc' },
            take: 20 
        })

        let rawHistory = previousMessages.reverse();
        rawHistory = rawHistory.filter(m => m.content !== msg.body);

        while (rawHistory.length > 0 && rawHistory[0].role === 'model') {
            rawHistory.shift(); 
        }

        const history: Content[] = rawHistory.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }))

        const aiRes = await this.aiService.chat(
            agent.id, 
            msg.body, 
            { 
                tenantId, 
                customerId: customer.id,
                customerPhone: phone,
                customerName: contactName
            },
            history
        )
        
        if (aiRes.response) {
            await msg.reply(aiRes.response)

            await prisma.message.create({
              data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
            })

            const duration = Date.now() - start
            logger.info({ 
                duration: `${duration}ms`, 
                to: phone 
            }, '📤 [WhatsApp] Resposta enviada com sucesso')
        }

      } catch (err: any) {
        logger.error({ err: err.message, stack: err.stack }, '❌ [WhatsApp] Erro crítico no pipeline')
        
        try {
            await msg.reply("⚠️ Desculpe, tive um erro técnico interno. Por favor, tente novamente.")
        } catch (replyErr) {
            logger.error('Falha crítica ao enviar erro.', replyErr)
        }
      }
    })

    // Inicialização
    try {
        await client.initialize()
        this.clients.set(tenantId, client)
    } catch (error) {
        logger.error({error}, '💀 [WhatsApp] Falha fatal ao inicializar Puppeteer')
        this.clearQrTimeout(tenantId)
        this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
    }
  }

  async stopClient(tenantId: string) {
    logger.info({ tenantId }, '🛑 [WhatsApp] Parando cliente e liberando memória...')
    
    // Garante que não há timers pendentes
    this.clearQrTimeout(tenantId)

    const client = this.clients.get(tenantId)
    
    if (client) {
        try {
            await client.destroy()
            logger.info({ tenantId }, '✅ [WhatsApp] Cliente destruído com sucesso.')
        } catch (e) {
            logger.error({ error: e, tenantId }, '⚠️ [WhatsApp] Erro ao destruir sessão')
        }
        this.clients.delete(tenantId)
    }
    
    this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
    
    await prisma.whatsAppSession.update({
        where: { tenantId },
        data: { status: 'DISCONNECTED' }
    })
  }

  // Helper para limpar o timeout
  private clearQrTimeout(tenantId: string) {
      if (this.qrTimeouts.has(tenantId)) {
          clearTimeout(this.qrTimeouts.get(tenantId))
          this.qrTimeouts.delete(tenantId)
          logger.debug({ tenantId }, '⏱️ [WhatsApp] Timer de QR Code cancelado.')
      }
  }
}