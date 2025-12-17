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
      logger.info('QR Code Gerado')
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
      logger.info({ phoneNumber }, '✅ WhatsApp Conectado!')

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

    // --- LÓGICA DE PROCESSAMENTO DE MENSAGENS ---
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
        // 2. Extração de Contato Blindada (Evita quebra se a lib falhar)
        let phone = msg.from.replace('@c.us', '');
        let contactName = 'Cliente';

        try {
            const contact = await msg.getContact();
            phone = contact.number;
            contactName = contact.pushname || contact.name || 'Cliente';
        } catch (contactError) {
            // Silencioso, usa o fallback
        }

        // 3. Identifica ou Cria Cliente no Banco
        let customer = await prisma.customer.findUnique({
            where: { tenantId_phone: { tenantId, phone } }
        })

        if (!customer) {
          customer = await prisma.customer.create({
            data: { tenantId, phone, name: contactName }
          })
        }

        // 4. Salva a Mensagem do Usuário
        await prisma.message.create({
          data: { tenantId, customerId: customer.id, role: 'user', content: msg.body }
        })

        // 5. Busca Agentes Ativos (Sistema de Exclusividade)
        const activeAgents = await prisma.agent.findMany({ 
            where: { tenantId, isActive: true } 
        })

        logger.info(`🔍 [DEBUG] Mensagem de ${phone}. Agentes Ativos: ${activeAgents.length}`)

        if (activeAgents.length === 0) {
            logger.warn(`⛔ [IGNORE] Nenhum agente ativo. O bot não responderá.`)
            return
        }

        if (activeAgents.length > 1) {
            logger.warn(`⚠️ [ALERTA] Múltiplos agentes ativos. Usando o primeiro: ${activeAgents[0].name}`)
        }

        const agent = activeAgents[0]
        logger.info(`🤖 [ACTION] Agente "${agent.name}" iniciando resposta...`)

        // 6. Preparação do Histórico (CORREÇÃO DO ERRO GEMINI)
        const previousMessages = await prisma.message.findMany({
            where: { tenantId, customerId: customer.id },
            orderBy: { createdAt: 'desc' },
            take: 30 
        })

        // Organiza: Antiga -> Nova
        let rawHistory = previousMessages.reverse();

        // Evita duplicar a mensagem atual se ela já foi salva
        rawHistory = rawHistory.filter(m => m.content !== msg.body);

        // --- CORREÇÃO CRÍTICA AQUI ---
        // O Gemini exige que o histórico comece com 'user'.
        // Removemos mensagens do 'model' (bot) do início até achar uma do usuário.
        while (rawHistory.length > 0 && rawHistory[0].role === 'model') {
            rawHistory.shift(); 
        }
        // -----------------------------

        // Formata para o SDK do Google
        const history: Content[] = rawHistory.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }))

        // 7. Chama a IA
        const aiRes = await this.aiService.chat(
            agent.id, 
            msg.body, 
            { tenantId, customerId: customer.id },
            history
        )
        
        // 8. Envia e Salva a Resposta
        if (aiRes.response) {
            await msg.reply(aiRes.response)

            await prisma.message.create({
              data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
            })
            
            logger.info('✅ [REPLY] Resposta enviada com sucesso.')
        }

      } catch (err) {
        logger.error({ err }, '❌ Erro crítico processando mensagem')
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