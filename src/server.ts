import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import Fastify from 'fastify'
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { aiRoutes } from './routes/ai.routes'
import { appointmentRoutes } from './routes/appointment.routes'
import { authRoutes } from './routes/auth.routes'
import { crmRoutes } from './routes/crm.routes'
import { serviceRoutes } from './routes/service.routes'
import { settingsRoutes } from './routes/settings.routes'
import { tenantRoutes } from './routes/tenant.routes'
import { userRoutes } from './routes/user.routes'
import { whatsappRoutes } from './routes/whatsapp.routes'

import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { ReminderService } from './services/reminder.service'
import { WhatsAppManager } from './services/whatsapp-manager.service'
import { WhatsAppWorker } from './services/whatsapp.worker'

import { contextPlugin } from './plugins/context.plugin'
import { errorHandlerPlugin } from './plugins/error-handler.plugin'

const app = Fastify()

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

app.register(contextPlugin)
app.register(errorHandlerPlugin)

app.register(cors, { origin: true })
app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret' })

app.register(authRoutes)
app.register(whatsappRoutes)
app.register(userRoutes)
app.register(tenantRoutes)
app.register(aiRoutes)
app.register(serviceRoutes)
app.register(crmRoutes)
app.register(appointmentRoutes)
app.register(settingsRoutes)

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

app.listen({ port: 3333, host: '0.0.0.0' }).then(async (address) => {
  logger.info(`🚀 CodeIA Backend (API Pura) rodando em ${address}`)
  logger.info(`📑 Documentação disponível em ${address}/docs`)
  
  // ✅ Iniciar WhatsApp Worker (processa jobs da fila)
  const whatsappWorker = new WhatsAppWorker()
  logger.info('📱 WhatsApp Worker ativado')
  
  // Restaura sessões ativas (enfileira jobs de START)
  await restoreSessions()
  
  // ✅ Iniciar loop de lembretes
  ReminderService.start()
  
  // Graceful shutdown
  const shutdown = async () => {
    logger.info('🛑 Encerrando servidor...')
    await whatsappWorker.shutdown()
    await app.close()
    process.exit(0)
  }
  
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
})