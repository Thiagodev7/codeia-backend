import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod'

// --- ROTAS DE NEGÓCIO ---
import { authRoutes } from './routes/auth.routes'
import { whatsappRoutes } from './routes/whatsapp.routes'
import { userRoutes } from './routes/user.routes'
import { tenantRoutes } from './routes/tenant.routes'
import { aiRoutes } from './routes/ai.routes'
import { serviceRoutes } from './routes/service.routes'
import { crmRoutes } from './routes/crm.routes'
import { appointmentRoutes } from './routes/appointment.routes'

// --- INFRAESTRUTURA & SERVICES ---
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { WhatsAppManager } from './services/whatsapp-manager.service'

// --- PLUGINS DE ARQUITETURA ---
import { contextPlugin } from './plugins/context.plugin'
import { errorHandlerPlugin } from './plugins/error-handler.plugin'

const app = Fastify()

// --- CONFIGURAÇÃO DO SWAGGER (ZOD) ---
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

// 1. Contexto & Logs
app.register(contextPlugin)

// 2. Tratamento de Erros Global
app.register(errorHandlerPlugin)

// 3. Segurança (CORS)
// Isso é vital agora que o front roda em outra porta (ex: 5173)
app.register(cors, { 
  origin: true // Em produção, troque 'true' pela URL do seu frontend (ex: https://app.codeia.com)
})

app.register(jwt, { 
  secret: process.env.JWT_SECRET || 'dev-secret' 
})

// --- REGISTRO DAS ROTAS DA API ---
app.register(authRoutes)
app.register(whatsappRoutes)
app.register(userRoutes)
app.register(tenantRoutes)
app.register(aiRoutes)
app.register(serviceRoutes)
app.register(crmRoutes)
app.register(appointmentRoutes)

// --- FUNÇÃO DE RESTAURAÇÃO DE SESSÕES (WHATSAPP) ---
async function restoreSessions() {
  try {
    const sessions = await prisma.whatsAppSession.findMany({ 
        where: { status: 'CONNECTED' } 
    })
    const manager = WhatsAppManager.getInstance()
    
    if(sessions.length > 0) {
      logger.info(`🔄 Restaurando ${sessions.length} sessões de WhatsApp...`)
      for (const session of sessions) {
        manager.startClient(
            session.tenantId, 
            session.id, 
            session.sessionName, 
            session.agentId
        )
      }
    }
  } catch (error) {
    logger.error({ error }, '❌ Erro crítico ao restaurar sessões')
  }
}

// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen({ port: 3333, host: '0.0.0.0' }).then(async (address) => {
  logger.info(`🚀 CodeIA Backend (API Pura) rodando em ${address}`)
  logger.info(`📑 Documentação disponível em ${address}/docs`)
  
  await restoreSessions()
})