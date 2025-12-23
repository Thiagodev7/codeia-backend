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

/**
 * Interface para estado da sessão em memória
 */
interface SessionInfo {
  status: string
  qrCode: string | null
  phoneNumber: string | null
  sessionName: string
}

/**
 * Gerenciador Singleton de Sessões do WhatsApp (Baileys)
 */
export class WhatsAppManager {
  private static instance: WhatsAppManager
  
  // Mantém as conexões ativas em memória
  private sockets: Map<string, WASocket> = new Map()
  // Mantém o estado atual para consulta rápida via API
  private sessions: Map<string, SessionInfo> = new Map()
  
  private aiService = new AIService()

  private constructor() {}

  public static getInstance(): WhatsAppManager {
    if (!WhatsAppManager.instance) {
      WhatsAppManager.instance = new WhatsAppManager()
    }
    return WhatsAppManager.instance
  }

  /**
   * Retorna o status atual de uma sessão específica
   */
  getSessionStatus(sessionId: string): SessionInfo {
    return this.sessions.get(sessionId) || { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName: '' }
  }

  /**
   * Inicia ou recupera uma sessão do WhatsApp
   */
  async startClient(tenantId: string, sessionId: string, sessionName: string, linkedAgentId?: string | null) {
    // Evita duplicidade de sockets para a mesma sessão
    if (this.sockets.has(sessionId)) return

    // Validação de segurança: A sessão ainda existe no banco?
    const sessionExists = await prisma.whatsAppSession.findUnique({ where: { id: sessionId } })
    if (!sessionExists) return

    logger.info({ tenantId, sessionId }, `🔄 [Baileys] Iniciando sessão: ${sessionName}`)
    this.updateSessionState(sessionId, { status: 'STARTING', qrCode: null, phoneNumber: null, sessionName })

    // Carrega credenciais do banco e versão atualizada da lib
    const { state, saveCreds } = await usePrismaAuthState(prisma, sessionId)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger as any),
        },
        printQRInTerminal: false, // QR Code será enviado via API/WebSocket, não no terminal
        logger: logger as any, 
        browser: ["CodeIA", "Chrome", "1.0.0"],
        syncFullHistory: false, // Otimização: Não sincroniza histórico antigo para agilizar o boot
        qrTimeout: 40000, // Tempo de vida do QR Code antes de renovar
    })

    this.sockets.set(sessionId, sock)

    // --- EVENTOS DE CONEXÃO ---
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        // Tratamento de QR Code
        if (qr) {
            logger.info({ sessionId }, '📱 [Baileys] QR Code gerado')
            try {
                const qrImage = await QRCode.toDataURL(qr)
                this.updateSessionState(sessionId, { status: 'QRCODE', qrCode: qrImage, phoneNumber: null, sessionName })
                // Atualiza status no banco sem bloquear a thread principal
                this.persistStatus(sessionId, 'QRCODE')
            } catch (err) { 
                logger.error({ err }, 'Erro ao gerar imagem do QR Code') 
            }
        }

        // Conexão Estabelecida
        if (connection === 'open') {
            const user = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown'
            logger.info({ sessionId, user }, '✅ [Baileys] Conectado!')
            
            this.updateSessionState(sessionId, { status: 'CONNECTED', qrCode: null, phoneNumber: user, sessionName })
            this.persistStatus(sessionId, 'CONNECTED')
        }

        // Conexão Fechada ou Queda
        if (connection === 'close') {
            // Se o socket foi removido manualmente (stopClient), não tentamos reconectar
            if (!this.sockets.has(sessionId)) return

            const error = lastDisconnect?.error as any
            const statusCode = error?.output?.statusCode
            const errorMessage = error?.message || ''

            // Identifica se foi um Timeout de QR Code ou rejeição do servidor
            const isQrTimeout = errorMessage.includes('QR refs attempts ended') || 
                                errorMessage.includes('Connection Terminated by Server') || 
                                statusCode === 408 || 
                                statusCode === 428

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !isQrTimeout
            
            logger.warn({ sessionId, statusCode, msg: errorMessage }, `❌ [Baileys] Desconectado. Reconectar: ${shouldReconnect}`)

            // Limpa socket da memória para evitar vazamento
            this.sockets.delete(sessionId)

            if (shouldReconnect) {
                // Backoff exponencial simples: espera 2s antes de tentar de novo
                setTimeout(() => this.startClient(tenantId, sessionId, sessionName, linkedAgentId), 2000)
            } else {
                // Encerra a sessão definitivamente se foi logout ou timeout
                this.updateSessionState(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName })
                this.persistStatus(sessionId, 'DISCONNECTED')
            }
        }
    })

    // Persistência de credenciais (Crucial para manter o login após restart)
    sock.ev.on('creds.update', saveCreds)

    // --- EVENTOS DE MENSAGEM ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return

        for (const msg of messages) {
            // Ignora mensagens vazias ou do próprio sistema (loop prevention)
            if (!msg.message) continue
            if (msg.key.fromMe) continue 

            const remoteJid = msg.key.remoteJid!
            // Ignora grupos e status/stories
            if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue

            const phone = remoteJid.split('@')[0]
            const name = msg.pushName || 'Cliente'
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text
            
            if (!text) continue

            // AsyncContext garante que os logs tenham o RequestId correto para rastreabilidade
            asyncContext.run({ requestId: `wa-${randomUUID()}`, tenantId, path: 'whatsapp-event' }, async () => {
                try {
                    logger.info({ phone }, '📩 Nova mensagem recebida')

                    // 1. Upsert do Cliente: Garante consistência e evita Race Conditions
                    const customer = await prisma.customer.upsert({
                        where: { tenantId_phone: { tenantId, phone } },
                        update: { name }, // Atualiza nome se mudou no Zap
                        create: { tenantId, phone, name }
                    })

                    // 2. Persiste mensagem do usuário
                    await prisma.message.create({
                        data: { tenantId, customerId: customer.id, role: 'user', content: text }
                    })
                    logger.info('💾 Mensagem do usuário salva.')

                    // 3. Resolução do Agente de IA
                    let agentIdToUse = linkedAgentId
                    if (!agentIdToUse) {
                        const anyAgent = await prisma.agent.findFirst({ where: { tenantId, isActive: true } })
                        agentIdToUse = anyAgent?.id
                    }

                    if (!agentIdToUse) {
                        logger.warn('⚠️ Nenhum agente ativo configurado para responder.')
                        return
                    }

                    // 4. Montagem do Histórico (Context Window)
                    // Busca as últimas interações para dar contexto à IA
                    const historyRaw = await prisma.message.findMany({
                        where: { 
                            tenantId, 
                            customerId: customer.id,
                            // Evita buscar a própria mensagem que acabamos de salvar (redundância)
                            id: { not: (await prisma.message.findFirst({ where: { tenantId, customerId: customer.id }, orderBy: { createdAt: 'desc' } }))?.id } 
                        },
                        orderBy: { createdAt: 'desc' },
                        take: 10
                    })

                    // Prepara formato para API do Gemini
                    let history = historyRaw.reverse().map(m => ({
                        role: m.role === 'user' ? 'user' : 'model',
                        parts: [{ text: m.content }]
                    })) as Content[]

                    // [CORREÇÃO CRÍTICA]: O Gemini exige que o turno inicie com 'user'.
                    // Se o recorte do histórico começar com 'model', removemos essa mensagem órfã.
                    if (history.length > 0 && history[0].role === 'model') {
                        history.shift()
                    }

                    // 5. Execução da IA
                    const aiRes = await this.aiService.chat(
                        agentIdToUse, 
                        text, 
                        { tenantId, customerId: customer.id, customerPhone: phone, customerName: name },
                        history
                    )

                    // 6. Envio e Persistência da Resposta
                    if (aiRes.response) {
                        await sock.sendMessage(remoteJid, { text: aiRes.response })
                        
                        await prisma.message.create({
                            data: { tenantId, customerId: customer.id, role: 'model', content: aiRes.response }
                        })
                        logger.info('🤖 Resposta da IA enviada e salva.')
                    }
                } catch (error: any) {
                    logger.error({ error: error.message }, '❌ Falha ao processar mensagem')
                }
            })
        }
    })
  }

  /**
   * Encerramento gracioso de uma sessão
   */
  async stopClient(sessionId: string) {
    const sock = this.sockets.get(sessionId)
    if (sock) {
        logger.info({ sessionId }, '🛑 Solicitando parada da sessão...')
        // Remove do mapa PRIMEIRO para evitar gatilho de reconexão no evento 'close'
        this.sockets.delete(sessionId)
        
        try {
            sock.end(undefined)
        } catch (e) {
            logger.warn('Erro ao fechar socket (pode já estar fechado)')
        }

        this.updateSessionState(sessionId, { status: 'DISCONNECTED', qrCode: null, phoneNumber: null, sessionName: '' })
        this.persistStatus(sessionId, 'DISCONNECTED')
    }
  }

  // Helpers privados para manter o código limpo
  private updateSessionState(sessionId: string, state: SessionInfo) {
      this.sessions.set(sessionId, state)
  }

  private async persistStatus(sessionId: string, status: string) {
      await prisma.whatsAppSession.update({ where: { id: sessionId }, data: { status } }).catch(() => {})
  }
}