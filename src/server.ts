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
import { aiRoutes } from './routes/ai.routes' // <--- DESCOMENTADO AQUI
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
app.register(cors)

app.register(jwt, { 
  secret: process.env.JWT_SECRET || 'dev-secret' 
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
app.register(aiRoutes) // <--- DESCOMENTADO AQUI TAMBÉM

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
app.listen({ port: 3333 }).then(async () => {
  logger.info('🚀 CodeIA Backend rodando em http://localhost:3333')
  logger.info('📑 Documentação em http://localhost:3333/docs')
  
  await restoreSessions()
})