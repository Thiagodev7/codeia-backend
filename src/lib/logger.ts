import pino from 'pino'
import path from 'path'
import fs from 'fs'
import { getLogContext } from './async-context'

// Garante que a pasta de logs existe
const logDir = path.join(process.cwd(), 'logs')
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir)
}

// Configuração de Redação (Segurança - Ocultar dados sensíveis)
const redactOptions = {
  paths: [
    'password', 
    'passwordHash', 
    'token', 
    'authorization', 
    'qrCode', 
    'buffer',
    '*.password', 
    '*.token'
  ],
  remove: true
}

// Configuração dos Transportes (Destinos dos logs)
const transport = pino.transport({
  targets: [
    // 1. Console Bonito (Para Desenvolvimento)
    {
      target: 'pino-pretty',
      level: 'info', // Mostra tudo de info para cima
      options: {
        colorize: true,
        translateTime: 'SYS:standard', // Horário legível
        ignore: 'pid,hostname', // Remove poluição visual
        // Formato customizado para ver o Contexto no console
        messageFormat: '{requestId} | {msg} \x1b[30m[{tenantId}]\x1b[0m' 
      }
    },
    // 2. Arquivo Persistente (Para Auditoria/Histórico)
    {
      target: 'pino/file',
      level: 'info',
      options: {
        destination: path.join(logDir, 'app.log'),
        mkdir: true // Cria a pasta se não existir (redundância)
      }
    }
  ]
})

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: redactOptions,
  base: {
    pid: process.pid,
    env: process.env.NODE_ENV
  }
}, transport) // <--- Injetamos os transportes aqui

// Proxy para injetar contexto (Mantemos igual à versão anterior)
export const logger = new Proxy(baseLogger, {
  get(target, property, receiver) {
    if (['info', 'warn', 'error', 'debug', 'fatal', 'trace'].includes(String(property))) {
      return (obj: object | string, msg?: string, ...args: any[]) => {
        const context = getLogContext()
        const method = target[property as keyof typeof target] as Function

        if (typeof obj === 'string') {
          method.apply(target, [{ ...context, msg: obj }, msg, ...args])
        } else {
          method.apply(target, [{ ...context, ...obj }, msg, ...args])
        }
      }
    }
    return Reflect.get(target, property, receiver)
  }
})