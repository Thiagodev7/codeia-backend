/**
 * Configuração de conexão Redis
 *
 * Este módulo fornece conexões Redis compartilhadas para:
 * - BullMQ (filas de jobs)
 * - Pub/Sub (notificações em tempo real)
 * - Cache de estado de sessões
 *
 * @module lib/redis
 */
import Redis from 'ioredis'
import { logger } from './logger'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

/**
 * Conexão principal do Redis
 * Usada para operações gerais e BullMQ
 */
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // Necessário para BullMQ workers
  enableReadyCheck: false,
  retryStrategy: (times) => {
    if (times > 10) {
      logger.error('❌ Redis: Máximo de tentativas de reconexão atingido')
      return null
    }
    const delay = Math.min(times * 200, 5000)
    logger.warn({ attempt: times, delay }, '🔄 Redis: Tentando reconectar...')
    return delay
  },
})

redis.on('connect', () => {
  logger.info('✅ Redis: Conexão estabelecida')
})

redis.on('error', (error) => {
  logger.error({ error: error.message }, '❌ Redis: Erro de conexão')
})

/**
 * Conexão duplicada para Pub/Sub
 * Redis requer conexões separadas para subscribe
 */
export const subscriber = redis.duplicate()

subscriber.on('error', (error) => {
  logger.error({ error: error.message }, '❌ Redis Subscriber: Erro de conexão')
})
