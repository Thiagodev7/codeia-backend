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
    if (this.clients.has(tenantId)) {
        logger.info({ tenantId }, '⚠️ [WhatsApp] Cliente já está rodando para este Tenant.')
        return
    }

    logger.info({ tenantId }, '🔄 [WhatsApp] Iniciando serviço...')
    
    this.sessions.set(tenantId, { status: 'STARTING', qrCode: null, phoneNumber: null })

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: tenantId }),
      puppeteer: { 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
      }
    })

    // --- EVENTOS DO CLIENTE ---

    client.on('qr', async (qr) => {
      logger.info({ tenantId }, '📱 [WhatsApp] QR Code gerado. Aguardando leitura...')
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

    client.on('disconnected', async (reason) => {
      logger.warn({ tenantId, reason }, '❌ [WhatsApp] Desconectado.')
      this.clients.delete(tenantId)
      this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
      
      await prisma.whatsAppSession.update({
        where: { tenantId },
        data: { status: 'DISCONNECTED' }
      })
    })

    // --- LÓGICA PRINCIPAL DE MENSAGENS ---

    client.on('message', async (msg) => {
      // 1. Filtros de Segurança (Ignora Grupos e Broadcasts)
      if (
        msg.from.includes('@g.us') ||       
        msg.from === 'status@broadcast' ||  
        msg.id.remote.includes('broadcast') 
      ) {
        return
      }

      const start = Date.now()
      
      try {
        // 2. Extração de Contato Blindada
        let phone = msg.from.replace('@c.us', '');
        let contactName = 'Cliente';

        try {
            const contact = await msg.getContact();
            phone = contact.number;
            contactName = contact.pushname || contact.name || 'Cliente';
        } catch (contactError) {
            logger.warn({ from: msg.from }, '⚠️ [WhatsApp] Falha ao obter dados detalhados do contato (usando fallback).')
        }

        logger.info({ 
            tenantId, 
            from: phone, 
            name: contactName, 
            body: msg.body 
        }, '📥 [WhatsApp] Mensagem Recebida')

        // 3. Identifica ou Cria Cliente no Banco
        let customer = await prisma.customer.findUnique({
            where: { tenantId_phone: { tenantId, phone } }
        })

        if (!customer) {
          logger.info({ phone, name: contactName }, '🆕 [CRM] Novo cliente detectado. Registrando...')
          customer = await prisma.customer.create({
            data: { tenantId, phone, name: contactName }
          })
        }

        // 4. Salva a Mensagem do Usuário no Histórico
        await prisma.message.create({
          data: { tenantId, customerId: customer.id, role: 'user', content: msg.body }
        })

        // 5. Busca Agentes Ativos
        const activeAgents = await prisma.agent.findMany({ 
            where: { tenantId, isActive: true } 
        })

        if (activeAgents.length === 0) {
            logger.debug({ tenantId }, '⛔ [IA] Nenhum agente ativo para responder.')
            return
        }

        const agent = activeAgents[0]
        logger.info({ agentId: agent.id, agentName: agent.name }, '🤖 [IA] Acionando Agente...')

        // 6. Preparação do Histórico (Context Window)
        const previousMessages = await prisma.message.findMany({
            where: { tenantId, customerId: customer.id },
            orderBy: { createdAt: 'desc' },
            take: 20 
        })

        let rawHistory = previousMessages.reverse();
        
        // Evita duplicar a última mensagem no prompt
        rawHistory = rawHistory.filter(m => m.content !== msg.body);

        // Regra do Gemini: Histórico deve começar com 'user'
        while (rawHistory.length > 0 && rawHistory[0].role === 'model') {
            rawHistory.shift(); 
        }

        const history: Content[] = rawHistory.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }))

        // 7. Chama a IA com CONTEXTO ENRIQUECIDO (Injeção de Dependência de Dados)
        // Aqui passamos o telefone e nome para que a IA não precise perguntar
        const aiRes = await this.aiService.chat(
            agent.id, 
            msg.body, 
            { 
                tenantId, 
                customerId: customer.id,
                customerPhone: phone,      // <--- DADO CRÍTICO
                customerName: contactName  // <--- DADO CRÍTICO
            },
            history
        )
        
        // 8. Envia e Salva a Resposta
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
        logger.error({ err: err.message, stack: err.stack }, '❌ [WhatsApp] Erro crítico no pipeline de mensagens')
        
        // Feedback para o usuário final em caso de erro fatal
        try {
            await msg.reply("⚠️ Desculpe, tive um erro técnico interno ao processar sua mensagem. Por favor, tente novamente em alguns instantes.")
        } catch (replyErr) {
            logger.error('Falha crítica: Não foi possível enviar mensagem de erro ao usuário.', replyErr)
        }
      }
    })

    // Inicialização do Cliente Puppeteer
    try {
        await client.initialize()
        this.clients.set(tenantId, client)
    } catch (error) {
        logger.error({error}, '💀 [WhatsApp] Falha fatal ao inicializar cliente do Puppeteer')
        this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
    }
  }

  async stopClient(tenantId: string) {
    logger.info({ tenantId }, '🛑 [WhatsApp] Solicitando parada do cliente...')
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
}