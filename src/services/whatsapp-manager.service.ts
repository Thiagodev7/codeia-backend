/**
 * WhatsApp Manager (Client-Side)
 * 
 * Cliente leve que enfileira comandos para o WhatsAppWorker via BullMQ.
 * Este módulo NÃO mantém conexões WebSocket - apenas:
 * 
 * 1. Enfileira jobs para START/STOP/SEND
 * 2. Escuta atualizações de status via Redis Pub/Sub
 * 3. Fornece cache de status das sessões
 * 
 * Esta arquitetura permite escalar a API horizontalmente enquanto
 * os workers processam as conexões WhatsApp de forma independente.
 * 
 * @module services/whatsapp-manager.service
 */
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import {
    WHATSAPP_SESSIONS_HASH,
    WHATSAPP_STATUS_CHANNEL,
    whatsappQueue
} from '../lib/queues'
import { redis, subscriber } from '../lib/redis'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface SessionInfo {
  status: string
  qrCode: string | null
  phoneNumber: string | null
  sessionName: string
}

// ---------------------------------------------------------------------------
// WhatsApp Manager (Proxy para Workers)
// ---------------------------------------------------------------------------

export class WhatsAppManager {
  private static instance: WhatsAppManager
  
  /** Cache local de status (atualizado via Pub/Sub) */
  private sessionsCache: Map<string, SessionInfo> = new Map()
  
  /** Flag para evitar múltiplas subscrições */
  private subscribed = false

  private constructor() {
    this.subscribeToUpdates()
  }

  /**
   * Singleton instance
   */
  public static getInstance(): WhatsAppManager {
    if (!WhatsAppManager.instance) {
      WhatsAppManager.instance = new WhatsAppManager()
    }
    return WhatsAppManager.instance
  }

  // ---------------------------------------------------------------------------
  // Subscrição de Atualizações (Redis Pub/Sub)
  // ---------------------------------------------------------------------------

  /**
   * Escuta atualizações de status vindas dos Workers
   */
  private subscribeToUpdates(): void {
    if (this.subscribed) return
    this.subscribed = true

    subscriber.subscribe(WHATSAPP_STATUS_CHANNEL, (err) => {
      if (err) {
        logger.error({ error: err.message }, '❌ Erro ao subscrever canal WhatsApp')
        return
      }
      logger.info('📡 WhatsApp Manager: Escutando atualizações de status...')
    })

    subscriber.on('message', (channel, message) => {
      if (channel === WHATSAPP_STATUS_CHANNEL) {
        try {
          const { sessionId, ...status } = JSON.parse(message)
          this.sessionsCache.set(sessionId, status)
          logger.debug({ sessionId, status: status.status }, '🔔 Status atualizado via Pub/Sub')
        } catch (e) {
          logger.warn('⚠️ Mensagem inválida no canal de status')
        }
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Status de Sessão
  // ---------------------------------------------------------------------------

  /**
   * Obtém status da sessão (cache local → Redis → fallback)
   */
  async getSessionStatus(sessionId: string): Promise<SessionInfo> {
    // 1. Tenta cache local (mais rápido)
    const cached = this.sessionsCache.get(sessionId)
    if (cached) return cached

    // 2. Tenta cache Redis (compartilhado entre instâncias)
    try {
      const redisData = await redis.hget(WHATSAPP_SESSIONS_HASH, sessionId)
      if (redisData) {
        const status = JSON.parse(redisData)
        this.sessionsCache.set(sessionId, status)
        return status
      }
    } catch (e) {
      logger.warn({ sessionId }, '⚠️ Erro ao ler status do Redis')
    }

    // 3. Fallback
    return { 
      status: 'DISCONNECTED', 
      qrCode: null, 
      phoneNumber: null, 
      sessionName: '' 
    }
  }

  // ---------------------------------------------------------------------------
  // Comandos (Enfileiram Jobs)
  // ---------------------------------------------------------------------------

  /**
   * Enfileira comando para iniciar sessão WhatsApp
   */
  async startClient(
    tenantId: string, 
    sessionId: string, 
    sessionName: string, 
    linkedAgentId?: string | null
  ): Promise<void> {
    logger.info({ sessionId, sessionName }, '📤 Enfileirando START_SESSION...')
    
    await whatsappQueue.add(
      'start-session',
      { 
        type: 'START_SESSION', 
        tenantId,
        sessionId, 
        sessionName, 
        agentId: linkedAgentId 
      },
      { 
        jobId: `start-${sessionId}`, // Evita duplicação
        removeOnComplete: true 
      }
    )
  }

  /**
   * Enfileira comando para parar sessão WhatsApp
   */
  async stopClient(sessionId: string): Promise<void> {
    logger.info({ sessionId }, '📤 Enfileirando STOP_SESSION...')
    
    // Remove do cache local imediatamente
    this.sessionsCache.delete(sessionId)
    
    await whatsappQueue.add(
      'stop-session',
      { type: 'STOP_SESSION', sessionId },
      { 
        jobId: `stop-${sessionId}`,
        removeOnComplete: true 
      }
    )
  }

  /**
   * Enfileira mensagem para envio
   * 
   * @returns true se enfileirou com sucesso, false se não há sessão disponível
   */
  async sendTextMessage(
    tenantId: string, 
    phone: string, 
    text: string
  ): Promise<boolean> {
    // Busca sessão ativa no banco
    const session = await prisma.whatsAppSession.findFirst({ 
      where: { tenantId, status: 'CONNECTED' } 
    })

    if (!session) {
      logger.warn({ tenantId, phone }, '⚠️ Nenhuma sessão conectada para envio')
      return false
    }

    logger.info({ phone, sessionId: session.id }, '📤 Enfileirando SEND_MESSAGE...')
    
    await whatsappQueue.add(
      'send-message',
      { 
        type: 'SEND_MESSAGE', 
        tenantId,
        sessionId: session.id, 
        phone, 
        text 
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 }
      }
    )

    return true
  }
}