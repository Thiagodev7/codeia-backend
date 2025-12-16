import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod'

import { authRoutes } from './routes/auth.routes'
import { whatsappRoutes } from './routes/whatsapp.routes'
import { userRoutes } from './routes/user.routes'
import { tenantRoutes } from './routes/tenant.routes'
import { aiRoutes } from './routes/ai.routes'
import { serviceRoutes } from './routes/service.routes'
import { crmRoutes } from './routes/crm.routes'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { WhatsAppManager } from './services/whatsapp-manager.service'


const app = Fastify()

// --- CONFIGURAÇÃO DO SWAGGER ---
app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

app.register(fastifySwagger, {
  openapi: {
    info: { title: 'CodeIA API', version: '1.0.0' },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }
    }
  },
  transform: jsonSchemaTransform,
})

app.register(fastifySwaggerUi, { routePrefix: '/docs' })

// --- PLUGINS GERAIS ---
app.register(cors, { 
  origin: true // Permite acesso de qualquer origem (importante para evitar bloqueio no navegador)
})

app.register(jwt, { 
  secret: process.env.JWT_SECRET || 'dev-secret' 
})

// --- LOG DE REQUISIÇÕES (AUDITORIA) ---
app.addHook('preHandler', (req, reply, done) => {
  if (req.body && (req.url.includes('/agents') || req.url.includes('/chat'))) {
    logger.info({ 
      method: req.method, 
      url: req.url, 
      body: req.body 
    }, '📥 [API] Recebendo Requisição')
  }
  done()
})

// --- FRONTEND (Arquivos Estáticos) ---
const publicPath = path.join(process.cwd(), 'public')

app.register(fastifyStatic, {
  root: publicPath,
  prefix: '/', 
})

logger.info(`📂 Servindo arquivos estáticos de: ${publicPath}`)

// --- ROTAS DA API ---
app.register(authRoutes)
app.register(whatsappRoutes)
app.register(userRoutes)
app.register(tenantRoutes)
app.register(aiRoutes)
app.register(serviceRoutes)
app.register(crmRoutes)

// --- FUNÇÃO DE RESTAURAÇÃO DE SESSÕES ---
async function restoreSessions() {
  try {
    const sessions = await prisma.whatsAppSession.findMany({ where: { status: 'CONNECTED' } })
    const manager = WhatsAppManager.getInstance()
    
    if(sessions.length > 0) {
      logger.info(`🔄 Restaurando ${sessions.length} sessões de WhatsApp...`)
      for (const session of sessions) {
        manager.startClient(session.tenantId)
      }
    }
  } catch (error) {
    logger.error('Erro ao restaurar sessões (Banco desconectado?)')
  }
}

// --- START ---
app.listen({ port: 3333, host: '0.0.0.0' }).then(async (address) => {
  logger.info(`🚀 CodeIA Backend rodando em ${address}`)
  logger.info(`📑 Documentação em ${address}/docs`)
  
  await restoreSessions()
})