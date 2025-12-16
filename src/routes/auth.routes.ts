import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { RegisterService } from '../services/register.service'
import { LoginService } from '../services/login.service'

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  
  app.post('/login', {
    schema: {
      tags: ['Autenticação'],
      body: z.object({ email: z.string().email(), password: z.string() }),
      response: {
        200: z.object({
          token: z.string(),
          user: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            phone: z.string().nullable(),
            role: z.string(),
            tenantId: z.string()
          })
        }),
        // Adicionei schema de erro para documentação
        401: z.object({
          message: z.string()
        })
      }
    }
  }, async (req, reply) => {
    try {
      const service = new LoginService()
      const { user } = await service.execute({ email: req.body.email, passwordPlain: req.body.password })
      
      const token = app.jwt.sign(
        { role: user.role, tenantId: user.tenantId },
        { sub: user.id, expiresIn: '7d' }
      )

      return reply.send({ token, user })

    } catch (error: any) {
      // Retorna o erro exato (ex: "Senha incorreta") para a tela
      return reply.status(401).send({ message: error.message })
    }
  })

  app.post('/register', {
    schema: {
      tags: ['Autenticação'],
      body: z.object({
        companyName: z.string(),
        document: z.string(),
        phone: z.string(),
        adminName: z.string(),
        email: z.string().email(),
        password: z.string().min(6),
      })
    }
  }, async (req, reply) => {
    const service = new RegisterService()
    const result = await service.execute(req.body)
    return reply.status(201).send(result)
  })
}