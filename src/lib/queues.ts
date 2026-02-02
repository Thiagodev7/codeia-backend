/**
 * Definição de Filas BullMQ
 *
 * Centraliza a criação de filas e tipos de jobs para processamento assíncrono.
 * A arquitetura de filas permite escalar workers independentemente da API.
 *
 * @module lib/queues
 */
import { Queue } from 'bullmq'
import { redis } from './redis'

// ---------------------------------------------------------------------------
// Tipos de Jobs WhatsApp
// ---------------------------------------------------------------------------

export interface StartSessionJob {
  type: 'START_SESSION'
  tenantId: string
  sessionId: string
  sessionName: string
  agentId?: string | null
}

export interface StopSessionJob {
  type: 'STOP_SESSION'
  sessionId: string
}

export interface SendMessageJob {
  type: 'SEND_MESSAGE'
  tenantId: string
  sessionId: string
  phone: string
  text: string
}

export type WhatsAppJobData = StartSessionJob | StopSessionJob | SendMessageJob

// ---------------------------------------------------------------------------
// Fila de Comandos WhatsApp
// ---------------------------------------------------------------------------

/**
 * Fila para comandos do WhatsApp
 *
 * Jobs processados pelo WhatsAppWorker:
 * - START_SESSION: Inicia nova conexão Baileys
 * - STOP_SESSION: Encerra conexão
 * - SEND_MESSAGE: Envia mensagem de texto
 */
export const whatsappQueue = new Queue<WhatsAppJobData>('whatsapp', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100, // Mantém últimos 100 jobs completos
    removeOnFail: 500, // Mantém últimos 500 jobs com falha para debug
    attempts: 3, // Tenta 3 vezes antes de falhar
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
})

// ---------------------------------------------------------------------------
// Canais Pub/Sub
// ---------------------------------------------------------------------------

export const WHATSAPP_STATUS_CHANNEL = 'whatsapp:status'
export const WHATSAPP_SESSIONS_HASH = 'whatsapp:sessions'

// ---------------------------------------------------------------------------
// Tipos de Jobs de Lembrete
// ---------------------------------------------------------------------------

export interface ReminderJobData {
  type: 'CHECK_REMINDERS'
}

// ---------------------------------------------------------------------------
// Fila de Lembretes
// ---------------------------------------------------------------------------

/**
 * Fila para jobs de lembrete
 *
 * Usa cron job para verificar agendamentos pendentes a cada minuto.
 * Processa apenas uma vez mesmo com múltiplas instâncias.
 */
export const reminderQueue = new Queue<ReminderJobData>('reminder', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
  },
})
