import makeWASocket, { 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys'
import * as QRCode from 'qrcode'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AIService } from './ai.service'
import { Content } from '@google/generative-ai'
import { asyncContext } from '../lib/async-context'
import { randomUUID } from 'node:crypto'
import { usePrismaAuthState } from '../lib/baileys-prisma-auth'

interface SessionInfo {
  status: string
  qrCode: string | null
  phoneNumber: string | null
  sessionName: string
}

export class WhatsAppManager {
  private static instance: WhatsAppManager
  
  private sockets: Map<string, any> = new Map()
  private sessions: Map<string, SessionInfo> = new Map()
  
  private aiService = new AIService()

  private constructor() {}

  public static getInstance(): WhatsAppManager {
    if (!WhatsAppManager.instance) {
      WhatsAppManager.instance = new WhatsAppManager()
    }
    return WhatsAppManager.instance
  }

  getSessionStatus(sessionId: string): SessionInfo {
    return this.sessions.get(sessionId) || { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName: '' }
  }

  async startClient(tenantId: string, sessionId: string, sessionName: string, linkedAgentId?: string | null) {
    if (this.sockets.has(sessionId)) return

    // Verifica se a sessão ainda existe no banco para evitar Zumbis
    const sessionExists = await prisma.whatsAppSession.findUnique({ where: { id: sessionId } })
    if (!sessionExists) return

    logger.info({ tenantId, sessionId }, `🔄 [Baileys] Iniciando sessão: ${sessionName}`)
    this.sessions.set(sessionId, { status: 'STARTING', qrCode: null, phoneNumber: null, sessionName })

    const { state, saveCreds } = await usePrismaAuthState(prisma, sessionId)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger as any),
        },
        printQRInTerminal: false,
        logger: logger as any, 
        browser: ["CodeIA", "Chrome", "1.0.0"],
        syncFullHistory: false 
    })

    this.sockets.set(sessionId, sock)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            logger.info({ sessionId }, '📱 [Baileys] QR Code gerado')
            const qrImage = await QRCode.toDataURL(qr)
            this.sessions.set(sessionId, { status: 'QRCODE', qrCode: qrImage, phoneNumber: null, sessionName })
            
            prisma.whatsAppSession.update({ where: { id: sessionId }, data: { status: 'QRCODE' } }).catch(() => {})
        }

        if (connection === 'open') {
            const user = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown'
            logger.info({ sessionId, user }, '✅ [Baileys] Conectado!')
            
            this.sessions.set(sessionId, { status: 'CONNECTED', qrCode: null, phoneNumber: user, sessionName })
            prisma.whatsAppSession.update({ where: { id: sessionId }, data: { status: 'CONNECTED' } }).catch(() => {})
        }

        if (connection === 'close') {
            // --- CORREÇÃO DE PARADA MANUAL ---
            // Se o socket não está mais no mapa 'this.sockets', foi removido por stopClient().
            // Então é uma parada intencional, IGNORAMOS o reconnect.
            if (!this.sockets.has(sessionId)) {
                logger.info({ sessionId }, '🛑 [Baileys] Conexão encerrada manualmente.')
                return
            }
            // ----------------------------------

            const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut
            
            logger.warn({ sessionId, statusCode }, `❌ [Baileys] Desconectado. Reconectar: ${shouldReconnect}`)

            // Limpa socket antigo
            this.sockets.delete(sessionId)

            if (shouldReconnect) {
                setTimeout(() => this.startClient(tenantId, sessionId, sessionName, linkedAgentId), 2000)
            } else {
                this.sessions.set(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName })
                prisma.whatsAppSession.update({ where: { id: sessionId }, data: { status: 'DISCONNECTED' } }).catch(() => {})
            }
        }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue

            const remoteJid = msg.key.remoteJid!
            // Ignora grupos e status (@g.us, status@broadcast)
            if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue

            const phone = remoteJid.split('@')[0]
            const name = msg.pushName || 'Cliente'
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text
            
            if (!text) continue

            asyncContext.run({ requestId: `wa-${randomUUID()}`, tenantId, path: 'whatsapp-event' }, async () => {
                try {
                    let customer = await prisma.customer.findUnique({
                        where: { tenantId_phone: { tenantId, phone } }
                    })
                    if (!customer) {
                        customer = await prisma.customer.create({ data: { tenantId, phone, name } })
                    }

                    await prisma.message.create({
                        data: { tenantId, customerId: customer.id, role: 'user', content: text }
                    })

                    let agentIdToUse = linkedAgentId
                    if (!agentIdToUse) {
                        const anyAgent = await prisma.agent.findFirst({ where: { tenantId, isActive: true } })
                        agentIdToUse = anyAgent?.id
                    }

                    if (!agentIdToUse) return

                    const historyRaw = await prisma.message.findMany({
                        where: { tenantId, customerId: customer.id },
                        orderBy: { createdAt: 'desc' },
                        take: 10
                    })
                    const history = historyRaw.reverse().filter(m => m.content !== text).map(m => ({
                        role: m.role === 'user' ? 'user' : 'model',
                        parts: [{ text: m.content }]
                    })) as Content[]

                    const aiRes = await this.aiService.chat(
                        agentIdToUse, 
                        text, 
                        { tenantId, customerId: customer.id, customerPhone: phone, customerName: name },
                        history
                    )

                    if (aiRes.response) {
                        await sock.sendMessage(remoteJid, { text: aiRes.response })
                        
                        await prisma.message.create({
                            data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
                        })
                    }
                } catch (error) {
                    logger.error({ error }, 'Erro ao processar mensagem Baileys')
                }
            })
        }
    })
  }

  async stopClient(sessionId: string) {
    const sock = this.sockets.get(sessionId)
    if (sock) {
        logger.info({ sessionId }, '🛑 Solicitando parada da sessão...')
        
        // 1. PRIMEIRO removemos da lista de ativos. 
        // Isso impede que o listener 'close' tente reconectar.
        this.sockets.delete(sessionId)
        
        // 2. DEPOIS encerramos a conexão
        sock.end(undefined)
        
        // 3. Atualizamos o estado
        this.sessions.set(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName: '' })
        
        await prisma.whatsAppSession.update({ 
            where: { id: sessionId }, 
            data: { status: 'DISCONNECTED' } 
        }).catch(() => {})
    }
  }
}