import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { UserService } from '../services/user.service'
import { Errors } from '../lib/errors'

/**
 * Rotas de Usuários (Equipe)
 * Gestão de membros do time que têm acesso ao painel.
 */
export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => {
    try {
      await req.jwtVerify()
    } catch (err) {
      throw Errors.Unauthorized('Token inválido')
    }
  })

  const userService = new UserService()

  // ---------------------------------------------------------------------------
  // GET /users - Listar Equipe
  // ---------------------------------------------------------------------------
  app.get('/users', {
    schema: {
      tags: ['Gestão de Equipe'],
      summary: 'Listar Usuários',
      description: 'Retorna todos os usuários cadastrados na conta da empresa.',
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

  // ---------------------------------------------------------------------------
  // POST /users - Criar Usuário
  // ---------------------------------------------------------------------------
  app.post('/users', {
    schema: {
      tags: ['Gestão de Equipe'],
      summary: 'Adicionar Membro',
      description: 'Convida um novo usuário para acessar o painel.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string().min(1, "Nome obrigatório"),
        email: z.string().email("E-mail inválido"),
        password: z.string().min(6, "Senha deve ter 6+ caracteres"),
        phone: z.string().optional(),
        role: z.enum(['ADMIN', 'AGENT']).default('AGENT')
      }),
      response: {
        201: z.object({
          id: z.string(),
          email: z.string()
        })
      }
    }
  }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const user = await userService.create(tenantId, req.body)
    return reply.status(201).send(user)
  })

  // ---------------------------------------------------------------------------
  // PUT /users/:id - Editar Usuário
  // ---------------------------------------------------------------------------
  app.put('/users/:id', {
    schema: {
      tags: ['Gestão de Equipe'],
      summary: 'Editar Membro',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
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
    const updated = await userService.update(tenantId, id, req.body)
    return reply.send(updated)
  })

  // ---------------------------------------------------------------------------
  // DELETE /users/:id - Remover Usuário
  // ---------------------------------------------------------------------------
  app.delete('/users/:id', {
    schema: {
      tags: ['Gestão de Equipe'],
      summary: 'Remover Membro',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() })
    }
  }, async (req, reply) => {
    const { tenantId, sub } = req.user as { tenantId: string, sub: string }
    const { id } = req.params
    
    // Regra de Negócio: Auto-deleção proibida
    if (id === sub) {
      throw Errors.BadRequest("Você não pode excluir sua própria conta.")
    }

    await userService.delete(tenantId, id)
    return reply.status(204).send()
  })
}