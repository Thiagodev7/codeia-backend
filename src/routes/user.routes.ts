import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { UserService } from '../services/user.service'

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  // Middleware de Segurança (Todas as rotas exigem Login)
  app.addHook('onRequest', async (req) => await req.jwtVerify())

  const userService = new UserService()

  // LISTAR
  app.get('/users', {
    schema: {
      tags: ['Team Management'],
      summary: 'Listar usuários da equipe',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.array(z.object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
          role: z.string(),
          phone: z.string().nullable()
        }))
      }
    }
  }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return userService.listByTenant(tenantId)
  })

  // CRIAR
  app.post('/users', {
    schema: {
      tags: ['Team Management'],
      summary: 'Adicionar novo membro ao time',
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string(),
        email: z.string().email(),
        password: z.string().min(6),
        phone: z.string().optional(),
        role: z.enum(['ADMIN', 'AGENT']).default('AGENT')
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const user = await userService.create(tenantId, req.body)
    return reply.status(201).send(user)
  })

  // EDITAR
  app.put('/users/:id', {
    schema: {
      tags: ['Team Management'],
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string() }),
      body: z.object({
        name: z.string().optional(),
        role: z.enum(['ADMIN', 'AGENT']).optional(),
        phone: z.string().optional(),
        password: z.string().min(6).optional()
      })
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params
    return userService.update(tenantId, id, req.body)
  })

  // DELETAR
  app.delete('/users/:id', {
    schema: {
      tags: ['Team Management'],
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string() })
    }
  }, async (req, reply) => {
    const { tenantId, sub } = req.user as { tenantId: string, sub: string } // sub é o ID de quem tá logado
    const { id } = req.params
    
    if (id === sub) {
      return reply.status(400).send({ error: "Você não pode deletar a si mesmo." })
    }

    await userService.delete(tenantId, id)
    return reply.status(204).send()
  })
}