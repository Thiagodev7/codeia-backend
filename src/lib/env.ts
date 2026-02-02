import { z } from 'zod'

/**
 * Schema de validação para variáveis de ambiente
 * Garante que todas as variáveis obrigatórias estejam presentes e válidas
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().describe('PostgreSQL connection string'),

  // Redis
  REDIS_HOST: z.string().default('localhost').describe('Redis host'),

  REDIS_PORT: z.string().regex(/^\d+$/).transform(Number).default('6379').describe('Redis port'),

  // JWT
  JWT_SECRET: z
    .string()
    .min(32, 'JWT secret deve ter no mínimo 32 caracteres')
    .describe('Secret para assinar tokens JWT'),

  // Google Gemini (aceita tanto GEMINI_API_KEY quanto GOOGLE_AI_KEY do .env.example)
  GEMINI_API_KEY: z
    .string()
    .min(1, 'GEMINI_API_KEY ou GOOGLE_AI_KEY é obrigatória')
    .optional()
    .transform((val) => val || process.env.GOOGLE_AI_KEY)
    .pipe(z.string().min(1, 'API Key do Gemini é obrigatória')),

  // Node Environment
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development')
    .describe('Ambiente de execução'),

  // Server
  PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default('3333')
    .describe('Porta do servidor HTTP'),
})

export type Env = z.infer<typeof envSchema>

/**
 * Valida e retorna as variáveis de ambiente
 * @throws {Error} Se alguma variável obrigatória estiver faltando ou inválida
 */
function validateEnv(): Env {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    console.error('❌ Erro de validação de variáveis de ambiente:')
    console.error(result.error.format())
    throw new Error('Configuração de ambiente inválida')
  }

  return result.data
}

/**
 * Variáveis de ambiente validadas e tipadas
 * Use esta constante em vez de process.env para ter type safety
 */
export const env = validateEnv()
