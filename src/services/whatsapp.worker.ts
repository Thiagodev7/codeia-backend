/**
 * WhatsApp Worker
 *
 * Worker dedicado que processa jobs da fila BullMQ para gerenciamento
 * de conexões WhatsApp via Baileys. Este worker pode rodar em processo
 * separado para escalar independentemente da API.
 *
 * Responsabilidades:
 * - Gerenciar conexões WebSocket (Baileys)
 * - Processar mensagens recebidas via IA
 * - Enviar mensagens de resposta/lembrete
 * - Publicar atualizações de status via Redis Pub/Sub
 *
 * @module services/whatsapp.worker
 */
import { Content } from '@google/generative-ai'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys'
import { Job, Worker } from 'bullmq'
import { randomUUID } from 'node:crypto'
import * as QRCode from 'qrcode'

import { asyncContext } from '../lib/async-context'
import { usePrismaAuthState } from '../lib/baileys-prisma-auth'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { WHATSAPP_SESSIONS_HASH, WHATSAPP_STATUS_CHANNEL, WhatsAppJobData } from '../lib/queues'
import { redis } from '../lib/redis'
import { AIService } from './ai.service'

const MAX_RECONNECTION_ATTEMPTS = 5

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface SessionInfo {
  status: string
  qrCode: string | null
  phoneNumber: string | null
  sessionName: string
}

interface ActiveSession {
  socket: WASocket
  tenantId: string
  agentId?: string | null
  sessionName: string
  retryCount: number
}

// ---------------------------------------------------------------------------
// WhatsApp Worker Class
// ---------------------------------------------------------------------------

export class WhatsAppWorker {
  /** Map de sockets ativos por sessionId */
  private sessions: Map<string, ActiveSession> = new Map()

  /** Instância do Worker BullMQ */
  private worker: Worker<WhatsAppJobData>

  /** Serviço de IA para processar mensagens */
  private aiService = new AIService()

  constructor() {
    this.worker = new Worker<WhatsAppJobData>('whatsapp', this.processJob.bind(this), {
      connection: redis,
      concurrency: 5, // Processa até 5 jobs em paralelo
    })

    this.worker.on('completed', (job) => {
      logger.debug({ jobId: job.id, type: job.data.type }, '✅ Job WhatsApp concluído')
    })

    this.worker.on('failed', (job, error) => {
      logger.error({ jobId: job?.id, error: error.message }, '❌ Job WhatsApp falhou')
    })

    logger.info('📱 WhatsApp Worker iniciado e aguardando jobs...')
  }

  // ---------------------------------------------------------------------------
  // Processamento de Jobs
  // ---------------------------------------------------------------------------

  private async processJob(job: Job<WhatsAppJobData>): Promise<any> {
    const { data } = job

    switch (data.type) {
      case 'START_SESSION':
        return this.startSession(data)

      case 'STOP_SESSION':
        return this.stopSession(data.sessionId)

      case 'SEND_MESSAGE':
        return this.sendMessage(data)

      default:
        logger.warn({ data }, '⚠️ Tipo de job desconhecido')
    }
  }

  // ---------------------------------------------------------------------------
  // Gerenciamento de Sessões
  // ---------------------------------------------------------------------------

  private async startSession(params: {
    tenantId: string
    sessionId: string
    sessionName: string
    agentId?: string | null
    retryCount?: number
  }): Promise<void> {
    const { tenantId, sessionId, sessionName, agentId, retryCount = 0 } = params

    // Evita duplicação
    if (this.sessions.has(sessionId)) {
      logger.warn({ sessionId }, '⚠️ Sessão já está ativa')
      return
    }

    const sessionExists = await prisma.whatsAppSession.findUnique({
      where: { id: sessionId },
    })
    if (!sessionExists) {
      logger.warn({ sessionId }, '⚠️ Sessão não encontrada no banco')
      return
    }

    logger.info({ tenantId, sessionId }, `🔄 [Worker] Iniciando sessão: ${sessionName}`)
    this.publishStatus(sessionId, {
      status: 'STARTING',
      qrCode: null,
      phoneNumber: null,
      sessionName,
    })

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
      browser: ['CodeIA', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      qrTimeout: 40000,
    })

    // Armazena sessão ativa
    this.sessions.set(sessionId, {
      socket: sock,
      tenantId,
      agentId,
      sessionName,
      retryCount,
    })

    // Event Handlers
    sock.ev.on('connection.update', async (update) => {
      await this.handleConnectionUpdate(sessionId, update)
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async (upsert) => {
      await this.handleIncomingMessages(sessionId, upsert)
    })
  }

  private async stopSession(sessionId: string, persist = true): Promise<void> {
    const session = this.sessions.get(sessionId)

    if (session) {
      this.sessions.delete(sessionId)
      try {
        session.socket.end(undefined)
      } catch (e) {
        // Ignora erros ao fechar
      }
    }

    this.publishStatus(sessionId, {
      status: 'DISCONNECTED',
      qrCode: null,
      phoneNumber: null,
      sessionName: '',
    })
    if (persist) {
      await this.persistStatus(sessionId, 'DISCONNECTED')
    }

    logger.info({ sessionId }, '🛑 [Worker] Sessão parada')
  }

  // ---------------------------------------------------------------------------
  // Envio de Mensagens
  // ---------------------------------------------------------------------------

  private async sendMessage(params: {
    tenantId: string
    sessionId: string
    phone: string
    text: string
  }): Promise<boolean> {
    const { tenantId, sessionId, phone, text } = params

    const session = this.sessions.get(sessionId)
    if (!session) {
      logger.warn({ sessionId }, '⚠️ [Worker] Sessão não encontrada para envio')
      return false
    }

    try {
      const jid = phone.includes('@s.whatsapp.net') ? phone : `${phone}@s.whatsapp.net`

      logger.info({ phone, tenantId }, '📤 [Worker] Enviando mensagem...')

      await session.socket.sendMessage(jid, { text })

      logger.info({ phone }, '✅ [Worker] Mensagem enviada!')
      return true
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error({ tenantId, error: errorMessage }, '❌ [Worker] Erro ao enviar')
      throw error // Re-throw para BullMQ tentar novamente
    }
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  private async handleConnectionUpdate(
    sessionId: string,
    update: Partial<{ connection: string; lastDisconnect: unknown; qr: string }>
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update
    const session = this.sessions.get(sessionId)

    if (!session) return

    if (qr) {
      try {
        const qrImage = await QRCode.toDataURL(qr)
        this.publishStatus(sessionId, {
          status: 'QRCODE',
          qrCode: qrImage,
          phoneNumber: null,
          sessionName: session.sessionName,
        })
        await this.persistStatus(sessionId, 'QRCODE')
      } catch (err) {
        logger.error({ err }, 'Erro ao gerar QR')
      }
    }

    if (connection === 'open') {
      const user = session.socket.user?.id ? session.socket.user.id.split(':')[0] : 'Unknown'

      logger.info({ sessionId, user }, '✅ [Worker] Conectado!')

      this.publishStatus(sessionId, {
        status: 'CONNECTED',
        qrCode: null,
        phoneNumber: user,
        sessionName: session.sessionName,
      })
      await this.persistStatus(sessionId, 'CONNECTED')

      // Reset retry count on successful connection
      session.retryCount = 0
    }

    if (connection === 'close') {
      if (!this.sessions.has(sessionId)) return

      const error = (lastDisconnect as { error?: { output?: { statusCode?: number } } })?.error
      const statusCode = error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      this.sessions.delete(sessionId)

      if (shouldReconnect) {
        if (session.retryCount >= MAX_RECONNECTION_ATTEMPTS) {
          logger.warn(
            { sessionId },
            `🛑 [Worker] Limite de tentativas de reconexão excedido (${MAX_RECONNECTION_ATTEMPTS}). Parando sessão.`
          )
          this.publishStatus(sessionId, {
            status: 'DISCONNECTED',
            qrCode: null,
            phoneNumber: null,
            sessionName: session.sessionName,
          })
          await this.persistStatus(sessionId, 'DISCONNECTED')
          return
        }

        const nextRetry = session.retryCount + 1
        logger.info({ sessionId, attempt: nextRetry }, '🔄 [Worker] Reconectando em 2s...')
        setTimeout(() => {
          this.startSession({
            tenantId: session.tenantId,
            sessionId,
            sessionName: session.sessionName,
            agentId: session.agentId,
            retryCount: nextRetry,
          })
        }, 2000)
      } else {
        this.publishStatus(sessionId, {
          status: 'DISCONNECTED',
          qrCode: null,
          phoneNumber: null,
          sessionName: session.sessionName,
        })
        await this.persistStatus(sessionId, 'DISCONNECTED')
      }
    }
  }

  private async handleIncomingMessages(
    sessionId: string,
    upsert: { messages: unknown[]; type: string }
  ): Promise<void> {
    const { messages, type } = upsert

    if (type !== 'notify') return

    const session = this.sessions.get(sessionId)
    if (!session) return

    for (const msg of messages as {
      message?: Record<string, unknown>
      key: { fromMe?: boolean; remoteJid?: string }
      pushName?: string
    }[]) {
      if (!msg.message || msg.key.fromMe) continue

      const remoteJid = msg.key.remoteJid!
      if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue

      const phone = remoteJid.split('@')[0]
      const name = msg.pushName || 'Cliente'
      const conversation = msg.message.conversation as string | undefined
      const extendedText = msg.message.extendedTextMessage as { text?: string } | undefined
      const text = conversation || extendedText?.text

      if (!text) continue

      // Processa mensagem em contexto isolado
      asyncContext.run(
        {
          requestId: `wa-${randomUUID()}`,
          tenantId: session.tenantId,
          path: 'whatsapp-event',
        },
        async () => {
          try {
            await this.processIncomingMessage({
              tenantId: session.tenantId,
              agentId: session.agentId,
              socket: session.socket,
              remoteJid,
              phone,
              name,
              text,
            })
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            logger.error({ error: errorMessage }, '❌ Erro ao processar mensagem')
          }
        }
      )
    }
  }

  private async processIncomingMessage(params: {
    tenantId: string
    agentId?: string | null
    socket: WASocket
    remoteJid: string
    phone: string
    name: string
    text: string
  }): Promise<void> {
    const { tenantId, agentId, socket, remoteJid, phone, name, text } = params

    // Upsert do cliente
    const customer = await prisma.customer.upsert({
      where: { tenantId_phone: { tenantId, phone } },
      update: { name },
      create: { tenantId, phone, name },
    })

    // Salva mensagem recebida
    await prisma.message.create({
      data: { tenantId, customerId: customer.id, role: 'user', content: text },
    })

    // Determina qual agente usar
    let agentIdToUse = agentId
    if (!agentIdToUse) {
      logger.debug({ tenantId }, '🔍 [Worker] Sessão sem agente vinculado, buscando padrão...')
      const anyAgent = await prisma.agent.findFirst({
        where: { tenantId, isActive: true },
      })
      agentIdToUse = anyAgent?.id
    }

    if (!agentIdToUse) {
      logger.warn({ tenantId, phone }, '⚠️ [Worker] Nenhum agente ativo encontrado para responder.')
      return
    }

    logger.debug({ phone, agentId: agentIdToUse }, '🤖 [Worker] Enviando para agente...')

    // Carrega histórico
    const historyRaw = await prisma.message.findMany({
      where: { tenantId, customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    let history = historyRaw.reverse().map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    })) as Content[]

    if (history.length > 0 && history[0].role === 'model') {
      history.shift()
    }

    // Processa com IA
    const aiRes = await this.aiService.chat(
      agentIdToUse,
      text,
      {
        tenantId,
        customerId: customer.id,
        customerPhone: phone,
        customerName: name,
      },
      history
    )

    // Envia resposta
    if (aiRes.response) {
      logger.info({ phone, response: aiRes.response }, '🤖 [Worker] Resposta da IA gerada')
      await socket.sendMessage(remoteJid, { text: aiRes.response })

      await prisma.message.create({
        data: {
          tenantId,
          customerId: customer.id,
          role: 'model',
          content: aiRes.response,
        },
      })
    } else {
      logger.info({ phone }, '🤖 [Worker] IA não retornou resposta (silêncio).')
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Publica status da sessão via Redis Pub/Sub e cache
   */
  private publishStatus(sessionId: string, status: SessionInfo): void {
    const payload = JSON.stringify({ sessionId, ...status })

    // Pub/Sub para notificações em tempo real
    redis.publish(WHATSAPP_STATUS_CHANNEL, payload)

    // Hash para cache de leitura
    redis.hset(WHATSAPP_SESSIONS_HASH, sessionId, JSON.stringify(status))
  }

  /**
   * Persiste status no banco de dados
   */
  private async persistStatus(sessionId: string, status: string): Promise<void> {
    await prisma.whatsAppSession
      .update({ where: { id: sessionId }, data: { status } })
      .catch(() => {})
  }

  /**
   * Para o worker gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Parando WhatsApp Worker...')

    // Para todas as sessões (sem persistir desconexão no banco, para permitir restore)
    for (const [sessionId] of this.sessions) {
      await this.stopSession(sessionId, false)
    }

    await this.worker.close()
    logger.info('✅ WhatsApp Worker parado')
  }
}
