// src/lib/errors.ts

export class AppError extends Error {
    public readonly statusCode: number
    public readonly code: string
    public readonly details?: any
  
    constructor(message: string, statusCode = 400, code = 'GENERIC_ERROR', details?: any) {
      super(message)
      this.statusCode = statusCode
      this.code = code
      this.details = details
      this.name = 'AppError'
    }
  }
  
  // Factory para erros comuns (Facilita o uso no dia a dia)
  export const Errors = {
    BadRequest: (msg: string, details?: any) => new AppError(msg, 400, 'BAD_REQUEST', details),
    NotFound: (msg: string) => new AppError(msg, 404, 'RESOURCE_NOT_FOUND'),
    Unauthorized: (msg: string) => new AppError(msg, 401, 'UNAUTHORIZED'),
    Forbidden: (msg: string) => new AppError(msg, 403, 'FORBIDDEN'),
    Conflict: (msg: string) => new AppError(msg, 409, 'CONFLICT'),
    Internal: (msg: string) => new AppError(msg, 500, 'INTERNAL_SERVER_ERROR'),
  }