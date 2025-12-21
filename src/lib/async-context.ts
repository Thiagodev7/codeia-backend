// src/lib/async-context.ts
import { AsyncLocalStorage } from 'node:async_hooks'

export interface LogContext {
  requestId: string
  tenantId?: string
  userId?: string
  path?: string
}

// Singleton do Storage
export const asyncContext = new AsyncLocalStorage<LogContext>()

// Helper para obter o contexto atual de forma segura
export function getLogContext(): LogContext {
  return asyncContext.getStore() || { requestId: 'sys-background' }
}