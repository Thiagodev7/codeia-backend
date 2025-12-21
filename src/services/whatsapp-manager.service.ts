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
}

/**
 * Gerenciador de Sessões do WhatsApp (Singleton)
 * Responsável por criar clientes Puppeteer, gerenciar eventos de socket e delegar mensagens para a IA.
 */
export class WhatsAppManager {
  private static instance: WhatsAppManager
  private clients: Map<string, Client> = new Map()
  private sessions: Map<string, SessionInfo> = new Map()
  private qrTimeouts: Map<string, NodeJS.Timeout> = new Map()
  
  private aiService = new AIService()
  private readonly QR_TIMEOUT_MS = 120 * 1000; // 2 minutos

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
        logger.info({ tenantId }, '⚠️ [WhatsApp] Cliente já está ativo. Ignorando solicitação.')
        return
    }

    logger.info({ tenantId }, '🔄 [WhatsApp] Alocando recursos e iniciando navegador...')
    this.sessions.set(tenantId, { status: 'STARTING', qrCode: null, phoneNumber: null })

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: tenantId }),
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

    // --- EVENTOS DO CLIENTE ---

    client.on('qr', async (qr) => {
      logger.info({ tenantId }, '📱 [WhatsApp] QR Code gerado.')
      const qrImage = await QRCode.toDataURL(qr)
      
      this.sessions.set(tenantId, { status: 'QRCODE', qrCode: qrImage, phoneNumber: null })

      await prisma.whatsAppSession.upsert({
        where: { tenantId },
        create: { tenantId, status: 'QRCODE' },
        update: { status: 'QRCODE' }
      })

      // Timeout para economizar memória se o usuário não ler o QR
      if (!this.qrTimeouts.has(tenantId)) {
          logger.info({ tenantId }, `⏳ [WhatsApp] Iniciando timer de expiração (${this.QR_TIMEOUT_MS / 1000}s)...`)
          const timeout = setTimeout(async () => {
              logger.warn({ tenantId }, '⏰ [WhatsApp] Timeout do QR Code. Encerrando processo.')
              await this.stopClient(tenantId)
          }, this.QR_TIMEOUT_MS)
          this.qrTimeouts.set(tenantId, timeout)
      }
    })

    client.on('ready', async () => {
      this.clearQrTimeout(tenantId)
      const phoneNumber = client.info.wid.user
      logger.info({ tenantId, phoneNumber }, '✅ [WhatsApp] Conectado e Pronto!')

      this.sessions.set(tenantId, { status: 'CONNECTED', qrCode: null, phoneNumber: phoneNumber })

      await prisma.whatsAppSession.update({
        where: { tenantId },
        data: { status: 'CONNECTED' }
      })
    })

    client.on('auth_failure', async () => {
        logger.error({ tenantId }, '❌ [WhatsApp] Falha na autenticação.')
        this.clearQrTimeout(tenantId)
        await this.stopClient(tenantId)
    })

    client.on('disconnected', async (reason) => {
      logger.warn({ tenantId, reason }, '❌ [WhatsApp] Desconectado.')
      this.clearQrTimeout(tenantId)
      this.clients.delete(tenantId)
      this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
      
      await prisma.whatsAppSession.update({
        where: { tenantId },
        data: { status: 'DISCONNECTED' }
      })
    })

    // --- LÓGICA DE MENSAGENS (COM CONTEXTO DE LOG) ---

    client.on('message', async (msg) => {
      // Ignora grupos e status broadcast
      if (msg.from.includes('@g.us') || msg.from === 'status@broadcast' || msg.id.remote.includes('broadcast')) return

      // Cria Contexto de Rastreabilidade para Logs
      const requestId = `wa-${randomUUID().split('-')[0]}`
      
      asyncContext.run({ requestId, tenantId, path: 'whatsapp-event' }, async () => {
          const start = Date.now()
          try {
            let phone = msg.from.replace('@c.us', '');
            let contactName = 'Cliente';

            try {
                const contact = await msg.getContact();
                phone = contact.number;
                contactName = contact.pushname || contact.name || 'Cliente';
            } catch (error) {
                logger.warn('⚠️ Falha ao obter dados detalhados do contato.')
            }

            logger.info({ from: phone, name: contactName, body: msg.body }, '📥 [WhatsApp] Mensagem Recebida')

            // 1. Identificação/Criação do Cliente (CRM)
            let customer = await prisma.customer.findUnique({
                where: { tenantId_phone: { tenantId, phone } }
            })

            if (!customer) {
              logger.info('🆕 [CRM] Novo cliente registrado automaticamente.')
              customer = await prisma.customer.create({
                data: { tenantId, phone, name: contactName }
              })
            }

            // 2. Persistência da Mensagem
            await prisma.message.create({
              data: { tenantId, customerId: customer.id, role: 'user', content: msg.body }
            })

            // 3. Verificação de Agentes Ativos
            const activeAgents = await prisma.agent.findMany({ where: { tenantId, isActive: true } })
            if (activeAgents.length === 0) {
                logger.debug('⛔ [IA] Nenhum agente ativo para responder.')
                return
            }
            const agent = activeAgents[0]

            // 4. Construção do Histórico
            const previousMessages = await prisma.message.findMany({
                where: { tenantId, customerId: customer.id },
                orderBy: { createdAt: 'desc' },
                take: 20 
            })

            let rawHistory = previousMessages.reverse();
            // Remove a mensagem atual para não duplicar no histórico enviado ao Gemini
            rawHistory = rawHistory.filter(m => m.content !== msg.body);
            // Garante que o histórico comece com 'user' (regra do Gemini)
            while (rawHistory.length > 0 && rawHistory[0].role === 'model') {
                rawHistory.shift(); 
            }

            const history: Content[] = rawHistory.map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }))

            // 5. Chamada à IA
            logger.info({ agentId: agent.id }, '🤖 [IA] Gerando resposta...')
            const aiRes = await this.aiService.chat(
                agent.id, 
                msg.body, 
                { tenantId, customerId: customer.id, customerPhone: phone, customerName: contactName },
                history
            )
            
            // 6. Envio da Resposta
            if (aiRes.response) {
                await msg.reply(aiRes.response)

                await prisma.message.create({
                  data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
                })

                const duration = Date.now() - start
                logger.info({ duration: `${duration}ms` }, '📤 [WhatsApp] Resposta enviada com sucesso')
            }

          } catch (err: any) {
            logger.error({ err: err.message, stack: err.stack }, '❌ [WhatsApp] Erro no processamento da mensagem')
            try {
                await msg.reply("⚠️ Desculpe, estou com uma instabilidade técnica momentânea.")
            } catch (replyErr) {
                logger.error('Falha crítica ao enviar mensagem de erro.')
            }
          }
      }) // Fim do Contexto
    })

    // Inicialização
    try {
        await client.initialize()
        this.clients.set(tenantId, client)
    } catch (error) {
        logger.error({ error }, '💀 [WhatsApp] Falha crítica ao inicializar Engine')
        this.clearQrTimeout(tenantId)
        this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
    }
  }

  async stopClient(tenantId: string) {
    logger.info({ tenantId }, '🛑 [WhatsApp] Parando serviço...')
    this.clearQrTimeout(tenantId)

    const client = this.clients.get(tenantId)
    if (client) {
        try {
            await client.destroy()
            logger.info({ tenantId }, '✅ [WhatsApp] Sessão encerrada.')
        } catch (e) {
            logger.error({ error: e, tenantId }, '⚠️ Erro ao destruir cliente')
        }
        this.clients.delete(tenantId)
    }
    
    this.sessions.set(tenantId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null })
    await prisma.whatsAppSession.update({ where: { tenantId }, data: { status: 'DISCONNECTED' } })
  }

  private clearQrTimeout(tenantId: string) {
      if (this.qrTimeouts.has(tenantId)) {
          clearTimeout(this.qrTimeouts.get(tenantId))
          this.qrTimeouts.delete(tenantId)
      }
  }
}