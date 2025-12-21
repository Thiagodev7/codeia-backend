// src/plugins/context.plugin.ts
import { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { asyncContext } from '../lib/async-context'
import { logger } from '../lib/logger'

export const contextPlugin: FastifyPluginAsync = async (app) => {
  // 1. Gera Request ID se não vier no header
  app.addHook('onRequest', (req, reply, done) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID()
    
    // Anexa ao reply para o cliente saber o ID
    reply.header('x-request-id', requestId)

    // Inicializa o contexto para esta requisição
    asyncContext.run({ 
      requestId,
      path: req.routerPath 
    }, () => {
      done()
    })
  })

  // 2. Log de Entrada e Saída (Request/Response)
  app.addHook('onResponse', async (req, reply) => {
    const context = asyncContext.getStore()
    
    // Tenta extrair tenantId e userId se a autenticação já tiver ocorrido
    // (Depende de como o JWT popula o req.user)
    const user = req.user as { tenantId?: string, id?: string } | undefined
    
    const duration = reply.getResponseTime()
    
    const logLevel = reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info'

    logger[logLevel]({
      type: 'http_access',
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      duration: `${duration.toFixed(2)}ms`,
      tenantId: user?.tenantId,
      userId: user?.id,
      ip: req.ip
    }, `HTTP ${req.method} ${req.routerPath || req.url}`)
  })
}