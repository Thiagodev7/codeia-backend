/**
 * Utilitários de Paginação
 * 
 * Fornece schemas Zod e helpers para implementar paginação consistente.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schemas Zod para Query Params
// ---------------------------------------------------------------------------

/**
 * Schema padrão para query params de paginação
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

// ---------------------------------------------------------------------------
// Schema Zod para Resposta Paginada
// ---------------------------------------------------------------------------

/**
 * Cria schema de resposta paginada para um tipo de dados
 */
export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) => 
  z.object({
    data: z.array(itemSchema),
    meta: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number()
    })
  })

// ---------------------------------------------------------------------------
// Tipos TypeScript
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Calcula skip para queries Prisma
 */
export const getSkip = (page: number, limit: number): number => (page - 1) * limit

/**
 * Constrói resposta paginada
 */
export const buildPaginatedResponse = <T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> => ({
  data,
  meta: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit)
  }
})
