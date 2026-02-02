import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { LoginService } from '../services/login.service'
import { RegisterService } from '../services/register.service'
// Importante: Não precisamos importar 'Errors' aqui pois os Services já lançam AppError,
// mas se precisarmos de validação extra, usaríamos.

/**
 * Rotas de Autenticação
 * Endpoints públicos para entrada e registro no sistema.
 */
export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------------------
  // POST /login - Autenticação
  // ---------------------------------------------------------------------------
  app.post(
    '/login',
    {
      schema: {
        tags: ['Autenticação'],
        summary: 'Entrar no Sistema',
        description: 'Autentica um usuário via e-mail e senha, retornando um token JWT.',
        body: z.object({
          email: z.string().email('E-mail inválido'),
          password: z.string().min(1, 'A senha é obrigatória'),
        }),
        response: {
          200: z
            .object({
              token: z.string().describe('Token JWT para autenticação'),
              user: z.object({
                id: z.string().uuid(),
                name: z.string(),
                email: z.string().email(),
                phone: z.string().nullable(),
                role: z.string(),
                tenantId: z.string().uuid(),
              }),
            })
            .describe('Login realizado com sucesso'),
        },
        examples: [
          {
            name: 'Login Sucesso',
            summary: 'Exemplo de login com credenciais válidas',
            value: {
              email: 'admin@empresa.com',
              password: 'senha123',
            },
          },
        ],
      },
    },
    async (req, reply) => {
      // Service lança AppError se falhar, o plugin captura. Sem try/catch aqui.
      const service = new LoginService()
      const { user } = await service.execute({
        email: req.body.email,
        passwordPlain: req.body.password,
      })

      const token = app.jwt.sign(
        { role: user.role, tenantId: user.tenantId },
        { sub: user.id, expiresIn: '7d' }
      )

      return reply.send({ token, user })
    }
  )

  // ---------------------------------------------------------------------------
  // POST /register - Novo Cadastro
  // ---------------------------------------------------------------------------
  app.post(
    '/register',
    {
      schema: {
        tags: ['Autenticação'],
        summary: 'Registrar Empresa',
        security: [{ bearerAuth: [] }],
        description: 'Cria uma nova conta de empresa (Tenant) e o usuário administrador.',
        body: z.object({
          companyName: z.string().min(3, 'Nome da empresa muito curto'),
          document: z.string().min(11, 'CPF/CNPJ inválido'),
          phone: z.string().min(10, 'Telefone inválido'),
          adminName: z.string().min(3, 'Nome do admin muito curto'),
          email: z.string().email('E-mail inválido'),
          password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres'),
        }),
        response: {
          201: z
            .object({
              tenant: z.object({ id: z.string().uuid(), name: z.string() }),
              user: z.object({ id: z.string().uuid(), email: z.string().email() }),
            })
            .describe('Empresa registrada com sucesso'),
        },
        examples: [
          {
            name: 'Nova Empresa',
            summary: 'Cadastro completo de nova empresa',
            value: {
              companyName: 'Barbearia Top',
              document: '12345678000199',
              phone: '11999999999',
              adminName: 'João Barbeiro',
              email: 'joao@barbearia.com',
              password: 'senha-segura-123',
            },
          },
        ],
      },
    },
    async (req, reply) => {
      const service = new RegisterService()
      const result = await service.execute(req.body)
      return reply.status(201).send(result)
    }
  )
}
