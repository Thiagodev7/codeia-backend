import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod'

import { authRoutes } from './routes/auth.routes'
import { userRoutes } from './routes/user.routes'     // <--- NOVO
import { tenantRoutes } from './routes/tenant.routes' // <--- NOVO
import { whatsappRoutes } from './routes/whatsapp.routes'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { WhatsAppManager } from './services/whatsapp-manager.service'

const app = Fastify()

// Configs Zod/Swagger
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

// Plugins
app.register(cors)
app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret' })

// Rotas
app.register(authRoutes)
app.register(whatsappRoutes)
app.register(userRoutes)    // <--- REGISTRAR
app.register(tenantRoutes)  // <--- REGISTRAR

// Função para restaurar sessões do WhatsApp ao reiniciar
async function restoreSessions() {
  const sessions = await prisma.whatsAppSession.findMany({ where: { status: 'CONNECTED' } })
  const manager = WhatsAppManager.getInstance()
  
  for (const session of sessions) {
    logger.info(`Restaurando sessão da empresa: ${session.tenantId}`)
    manager.startClient(session.tenantId)
  }
}

// Start
app.listen({ port: 3333 }).then(async () => {
  logger.info('🚀 CodeIA Backend rodando em http://localhost:3333')
  logger.info('📑 Swagger em http://localhost:3333/docs')
  
  await restoreSessions()
})