/**
 * Testes Unitários: SettingsService
 *
 * Testa a lógica de configurações de tenant e usuário.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../../../lib/prisma'
import { SettingsService } from '../../../services/settings.service'

const mockedPrisma = vi.mocked(prisma, true)

describe('SettingsService', () => {
  let service: SettingsService
  const tenantId = 'tenant-123'
  const userId = 'user-123'

  beforeEach(() => {
    service = new SettingsService()
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // getTenantSettings
  // ---------------------------------------------------------------------------
  describe('getTenantSettings', () => {
    it('should return existing settings with business hours', async () => {
      const mockSettings = {
        id: 'settings-123',
        tenantId,
        reminderEnabled: true,
        reminderMinutes: 60,
      }

      const mockBusinessHours = [
        { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isOpen: true },
        { dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isOpen: true },
      ]

      mockedPrisma.tenantSettings.upsert.mockResolvedValue(mockSettings as any)
      mockedPrisma.businessHour.findMany.mockResolvedValue(mockBusinessHours as any)

      const result = await service.getTenantSettings(tenantId)

      expect(result).toHaveProperty('reminderEnabled', true)
      expect(result).toHaveProperty('businessHours')
      expect(result.businessHours).toHaveLength(2)
      expect(mockedPrisma.tenantSettings.upsert).toHaveBeenCalledWith({
        where: { tenantId },
        create: { tenantId },
        update: {},
      })
    })

    it('should create settings if they do not exist', async () => {
      const mockSettings = {
        id: 'settings-123',
        tenantId,
        reminderEnabled: false,
      }

      mockedPrisma.tenantSettings.upsert.mockResolvedValue(mockSettings as any)
      mockedPrisma.businessHour.findMany.mockResolvedValue([])

      await service.getTenantSettings(tenantId)

      expect(mockedPrisma.tenantSettings.upsert).toHaveBeenCalledWith({
        where: { tenantId },
        create: { tenantId },
        update: {},
      })
    })
  })

  // ---------------------------------------------------------------------------
  // updateTenantSettings
  // ---------------------------------------------------------------------------
  describe('updateTenantSettings', () => {
    it('should update basic settings successfully', async () => {
      const updatedData = {
        businessName: 'New Business Name',
        primaryColor: '#FF0000',
        timezone: 'America/Sao_Paulo',
      }

      mockedPrisma.tenantSettings.upsert.mockResolvedValue({
        id: 'settings-123',
        tenantId,
        ...updatedData,
      } as any)
      mockedPrisma.businessHour.findMany.mockResolvedValue([])

      await service.updateTenantSettings(tenantId, updatedData)

      expect(mockedPrisma.tenantSettings.upsert).toHaveBeenCalled()
    })

    it('should update business hours when provided', async () => {
      const businessHours = [
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isOpen: true },
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isOpen: true },
      ]

      mockedPrisma.tenantSettings.upsert.mockResolvedValue({ id: 'settings-123', tenantId } as any)
      mockedPrisma.businessHour.findMany.mockResolvedValue([])
      mockedPrisma.$transaction.mockImplementation(async (operations) => {
        return operations
      })

      await service.updateTenantSettings(tenantId, { businessHours })

      expect(mockedPrisma.$transaction).toHaveBeenCalled()
    })

    it('should throw Forbidden when enabling reminder on FREE plan', async () => {
      const mockTenant = {
        id: tenantId,
        plan: 'FREE',
      }

      mockedPrisma.tenant.findUnique.mockResolvedValue(mockTenant as any)

      await expect(
        service.updateTenantSettings(tenantId, { reminderEnabled: true })
      ).rejects.toThrow('Recurso exclusivo')
    })

    it('should allow reminder on SECONDARY plan', async () => {
      const mockTenant = {
        id: tenantId,
        plan: 'SECONDARY',
      }

      mockedPrisma.tenant.findUnique.mockResolvedValue(mockTenant as any)
      mockedPrisma.tenantSettings.upsert.mockResolvedValue({ id: 'settings-123', tenantId } as any)
      mockedPrisma.businessHour.findMany.mockResolvedValue([])

      await service.updateTenantSettings(tenantId, { reminderEnabled: true })

      expect(mockedPrisma.tenantSettings.upsert).toHaveBeenCalled()
    })

    it('should allow reminder on THIRD plan', async () => {
      const mockTenant = {
        id: tenantId,
        plan: 'THIRD',
      }

      mockedPrisma.tenant.findUnique.mockResolvedValue(mockTenant as any)
      mockedPrisma.tenantSettings.upsert.mockResolvedValue({ id: 'settings-123', tenantId } as any)
      mockedPrisma.businessHour.findMany.mockResolvedValue([])

      await service.updateTenantSettings(tenantId, { reminderEnabled: true })

      expect(mockedPrisma.tenantSettings.upsert).toHaveBeenCalled()
    })

    it('should allow reminder on UNLIMITED plan', async () => {
      const mockTenant = {
        id: tenantId,
        plan: 'UNLIMITED',
      }

      mockedPrisma.tenant.findUnique.mockResolvedValue(mockTenant as any)
      mockedPrisma.tenantSettings.upsert.mockResolvedValue({ id: 'settings-123', tenantId } as any)
      mockedPrisma.businessHour.findMany.mockResolvedValue([])

      await service.updateTenantSettings(tenantId, { reminderEnabled: true })

      expect(mockedPrisma.tenantSettings.upsert).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // getUserSettings
  // ---------------------------------------------------------------------------
  describe('getUserSettings', () => {
    it('should return existing user settings', async () => {
      const mockSettings = {
        id: 'user-settings-123',
        userId,
        theme: 'dark',
        notifications: true,
      }

      mockedPrisma.userSettings.upsert.mockResolvedValue(mockSettings as any)

      const result = await service.getUserSettings(userId)

      expect(result).toHaveProperty('theme', 'dark')
      expect(mockedPrisma.userSettings.upsert).toHaveBeenCalledWith({
        where: { userId },
        create: { userId },
        update: {},
      })
    })

    it('should create settings if they do not exist', async () => {
      const mockSettings = {
        id: 'user-settings-123',
        userId,
      }

      mockedPrisma.userSettings.upsert.mockResolvedValue(mockSettings as any)

      await service.getUserSettings(userId)

      expect(mockedPrisma.userSettings.upsert).toHaveBeenCalledWith({
        where: { userId },
        create: { userId },
        update: {},
      })
    })
  })

  // ---------------------------------------------------------------------------
  // updateUserSettings
  // ---------------------------------------------------------------------------
  describe('updateUserSettings', () => {
    it('should update user settings successfully', async () => {
      const updatedData = {
        theme: 'light',
        notifications: false,
      }

      mockedPrisma.userSettings.upsert.mockResolvedValue({
        id: 'user-settings-123',
        userId,
        ...updatedData,
      } as any)

      const result = await service.updateUserSettings(userId, updatedData)

      expect(result).toHaveProperty('theme', 'light')
      expect(mockedPrisma.userSettings.upsert).toHaveBeenCalledWith({
        where: { userId },
        create: { userId, ...updatedData },
        update: updatedData,
      })
    })
  })
})
