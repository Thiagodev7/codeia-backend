// src/plugins/error-handler.plugin.ts
import { FastifyPluginAsync } from 'fastify'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { AppError } from '../lib/errors'
import { logger } from '../lib/logger'
import { getLogContext } from '../lib/async-context'

export const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error, req, reply) => {
    const { requestId } = getLogContext()

    // 1. Erros de Aplicação Conhecidos (Nós lançamos intencionalmente)
    if (error instanceof AppError) {
      // Log como WARN pois é regra de negócio, não falha de sistema
      logger.warn({ code: error.code, details: error.details }, error.message)

      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
      })
    }

    // 2. Erros de Validação (Zod / Fastify Schema)
    if (error instanceof ZodError) {
      logger.warn({ issues: error.issues }, '⚠️ Falha de Validação')

      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Dados de entrada inválidos.',
        details: error.format(),
        requestId,
      })
    }

    // 3. Erros do Prisma (Banco de Dados)
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002: Violação de Unicidade (ex: Email já existe)
      if (error.code === 'P2002') {
        const fields = (error.meta as any)?.target || []
        logger.warn({ fields }, '⚠️ Conflito de unicidade no banco')

        return reply.status(409).send({
          code: 'CONFLICT_ERROR',
          message: `Já existe um registro com este valor: ${fields}`,
          requestId,
        })
      }

      // P2025: Registro não encontrado (no update/delete)
      if (error.code === 'P2025') {
        return reply.status(404).send({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Registro não encontrado.',
          requestId,
        })
      }
    }

    // 4. Erros Desconhecidos (Crash / Bug / NullPointer)
    // Logamos como ERROR com Stack Trace completo para investigar
    logger.error(
      { error: error.name, message: error.message, stack: error.stack },
      '🔥 CRITICAL SERVER ERROR'
    )

    return reply.status(500).send({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Ocorreu um erro interno no servidor. Nossa equipe foi notificada.',
      requestId, // Importante para o usuário informar no suporte
    })
  })
}
