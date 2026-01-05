import makeWASocket, { 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket
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
  
  private sockets: Map<string, WASocket> = new Map()
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

  // ✅ MÉTODO DE ENVIO ATIVO (Lembretes) - COM LOGS
  async sendTextMessage(tenantId: string, phone: string, text: string): Promise<boolean> {
    const session = await prisma.whatsAppSession.findFirst({
        where: { tenantId, status: 'CONNECTED' }
    })

    if (!session) {
        logger.warn({ tenantId, phone }, '⚠️ [WhatsApp] Falha ao enviar: Nenhuma sessão conectada para este Tenant.')
        return false
    }

    const sock = this.sockets.get(session.id)
    if (!sock) {
        logger.warn({ sessionId: session.id }, '⚠️ [WhatsApp] Socket não encontrado em memória.')
        return false
    }

    try {
        // Formata o número (garante o sufixo do whats)
        const jid = phone.includes('@s.whatsapp.net') ? phone : `${phone}@s.whatsapp.net`
        
        logger.info({ phone, tenantId }, '📤 [WhatsApp] Enviando mensagem ativa...')
        
        await sock.sendMessage(jid, { text })
        
        logger.info({ phone }, '✅ [WhatsApp] Mensagem enviada com sucesso!')
        return true
    } catch (error: any) {
        logger.error({ tenantId, error: error.message }, '❌ [WhatsApp] Erro ao enviar mensagem')
        return false
    }
  }

  // --- (O RESTO DO ARQUIVO PERMANECE IGUAL) ---
  // Copie abaixo o restante do código original (startClient, stopClient, etc)
  // ...
  async startClient(tenantId: string, sessionId: string, sessionName: string, linkedAgentId?: string | null) {
    if (this.sockets.has(sessionId)) return

    const sessionExists = await prisma.whatsAppSession.findUnique({ where: { id: sessionId } })
    if (!sessionExists) return

    logger.info({ tenantId, sessionId }, `🔄 [Baileys] Iniciando sessão: ${sessionName}`)
    this.updateSessionState(sessionId, { status: 'STARTING', qrCode: null, phoneNumber: null, sessionName })

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
        syncFullHistory: false,
        qrTimeout: 40000,
    })

    this.sockets.set(sessionId, sock)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            try {
                const qrImage = await QRCode.toDataURL(qr)
                this.updateSessionState(sessionId, { status: 'QRCODE', qrCode: qrImage, phoneNumber: null, sessionName })
                this.persistStatus(sessionId, 'QRCODE')
            } catch (err) { logger.error({ err }, 'Erro QR') }
        }

        if (connection === 'open') {
            const user = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown'
            logger.info({ sessionId, user }, '✅ [Baileys] Conectado!')
            this.updateSessionState(sessionId, { status: 'CONNECTED', qrCode: null, phoneNumber: user, sessionName })
            this.persistStatus(sessionId, 'CONNECTED')
        }

        if (connection === 'close') {
            if (!this.sockets.has(sessionId)) return
            const error = lastDisconnect?.error as any
            const statusCode = error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut
            
            this.sockets.delete(sessionId)

            if (shouldReconnect) {
                setTimeout(() => this.startClient(tenantId, sessionId, sessionName, linkedAgentId), 2000)
            } else {
                this.updateSessionState(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName })
                this.persistStatus(sessionId, 'DISCONNECTED')
            }
        }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue 
            const remoteJid = msg.key.remoteJid!
            if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue

            const phone = remoteJid.split('@')[0]
            const name = msg.pushName || 'Cliente'
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text
            
            if (!text) continue

            asyncContext.run({ requestId: `wa-${randomUUID()}`, tenantId, path: 'whatsapp-event' }, async () => {
                try {
                    const customer = await prisma.customer.upsert({
                        where: { tenantId_phone: { tenantId, phone } },
                        update: { name },
                        create: { tenantId, phone, name }
                    })
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
                    let history = historyRaw.reverse().map(m => ({
                        role: m.role === 'user' ? 'user' : 'model',
                        parts: [{ text: m.content }]
                    })) as Content[]
                    if (history.length > 0 && history[0].role === 'model') history.shift()

                    const aiRes = await this.aiService.chat(
                        agentIdToUse, text, 
                        { tenantId, customerId: customer.id, customerPhone: phone, customerName: name },
                        history
                    )

                    if (aiRes.response) {
                        await sock.sendMessage(remoteJid, { text: aiRes.response })
                        await prisma.message.create({
                            data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
                        })
                    }
                } catch (error) {}
            })
        }
    })
  }

  async stopClient(sessionId: string) {
      const sock = this.sockets.get(sessionId)
      if (sock) {
          this.sockets.delete(sessionId)
          try { sock.end(undefined) } catch (e) {}
          this.updateSessionState(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName: '' })
          this.persistStatus(sessionId, 'DISCONNECTED')
      }
  }

  private updateSessionState(sessionId: string, state: SessionInfo) {
      this.sessions.set(sessionId, state)
  }

  private async persistStatus(sessionId: string, status: string) {
      await prisma.whatsAppSession.update({ where: { id: sessionId }, data: { status } }).catch(() => {})
  }
}