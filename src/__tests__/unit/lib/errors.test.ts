/**
 * Testes Unitários: Errors Lib
 *
 * Testa a classe AppError e os factories de erros.
 */
import { describe, expect, it } from 'vitest'
import { AppError, Errors } from '../../../lib/errors'

describe('AppError', () => {
  it('should create error with correct properties', () => {
    const error = new AppError('Test message', 400, 'TEST_CODE', { field: 'value' })

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(AppError)
    expect(error.message).toBe('Test message')
    expect(error.statusCode).toBe(400)
    expect(error.code).toBe('TEST_CODE')
    expect(error.details).toEqual({ field: 'value' })
    expect(error.name).toBe('AppError')
  })

  it('should use default values when not provided', () => {
    const error = new AppError('Simple error')

    expect(error.statusCode).toBe(400)
    expect(error.code).toBe('GENERIC_ERROR')
    expect(error.details).toBeUndefined()
  })
})

describe('Errors Factory', () => {
  describe('BadRequest', () => {
    it('should create 400 error', () => {
      const error = Errors.BadRequest('Invalid input', { field: 'email' })

      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('BAD_REQUEST')
      expect(error.message).toBe('Invalid input')
      expect(error.details).toEqual({ field: 'email' })
    })
  })

  describe('NotFound', () => {
    it('should create 404 error', () => {
      const error = Errors.NotFound('User not found')

      expect(error.statusCode).toBe(404)
      expect(error.code).toBe('RESOURCE_NOT_FOUND')
      expect(error.message).toBe('User not found')
    })
  })

  describe('Unauthorized', () => {
    it('should create 401 error', () => {
      const error = Errors.Unauthorized('Invalid token')

      expect(error.statusCode).toBe(401)
      expect(error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('Forbidden', () => {
    it('should create 403 error', () => {
      const error = Errors.Forbidden('Access denied')

      expect(error.statusCode).toBe(403)
      expect(error.code).toBe('FORBIDDEN')
    })
  })

  describe('Conflict', () => {
    it('should create 409 error', () => {
      const error = Errors.Conflict('Email already exists')

      expect(error.statusCode).toBe(409)
      expect(error.code).toBe('CONFLICT')
    })
  })

  describe('Internal', () => {
    it('should create 500 error', () => {
      const error = Errors.Internal('Something went wrong')

      expect(error.statusCode).toBe(500)
      expect(error.code).toBe('INTERNAL_SERVER_ERROR')
    })
  })
})
