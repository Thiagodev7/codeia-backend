// src/services/settings.service.ts
import { Errors } from '../lib/errors' // ✅ Importante
import { prisma } from '../lib/prisma'

interface BusinessHourInput {
  dayOfWeek: number
  startTime: string
  endTime: string
  isOpen: boolean
}

/**
 * Service de Configurações
 *
 * Gerencia configurações de tenant (negócio) e usuários individuais.
 * Inclui horários de funcionamento, tema, notificações e lembretes.
 *
 * @remarks
 * - Lembretes são exclusivos para planos pagos (feature gating)
 * - Configurações são criadas automaticamente se não existirem (upsert)
 * - BusinessHours suportam configuração por dia da semana
 *
 * @example
 * ```typescript
 * const service = new SettingsService()
 * const settings = await service.getTenantSettings('tenant-123')
 * ```
 */
export class SettingsService {
  /**
   * Obtém configurações do tenant
   *
   * @param tenantId - ID do tenant
   * @returns Configurações do tenant com horários de funcionamento
   *
   * @remarks
   * - Cria registro automaticamente se não existir
   * - Retorna businessHours ordenados por dia da semana
   *
   * @example
   * ```typescript
   * const settings = await service.getTenantSettings('tenant-123')
   * // { reminderEnabled: true, businessHours: [...] }
   * ```
   */
  async getTenantSettings(tenantId: string) {
    const settings = await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    })

    const businessHours = await prisma.businessHour.findMany({
      where: { tenantId },
      orderBy: { dayOfWeek: 'asc' },
    })

    return { ...settings, businessHours }
  }

  /**
   * Atualiza configurações do tenant
   *
   * @param tenantId - ID do tenant
   * @param data - Dados a atualizar (settings + businessHours)
   * @returns Configurações atualizadas com horários
   * @throws {AppError} Forbidden se tentar ativar reminder no plano FREE
   *
   * @remarks
   * - Feature gating: reminder requer plano pago (SECONDARY, THIRD, UNLIMITED)
   * - BusinessHours são recriados completamente (deleteMany + create)
   * - Operação em transação para consistência
   *
   * @example
   * ```typescript
   * await service.updateTenantSettings('tenant-123', {
   *   primaryColor: '#FF0000',
   *   reminderEnabled: true,
   *   businessHours: [
   *     { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isOpen: true }
   *   ]
   * })
   * ```
   */
  async updateTenantSettings(
    tenantId: string,
    data: Partial<{
      businessName?: string | null
      description?: string | null
      primaryColor?: string | null
      logoUrl?: string | null
      contactPhone?: string | null
      website?: string | null
      address?: string | null
      timezone?: string | null
      currency?: string | null
      reminderEnabled?: boolean | null
      reminderMinutes?: number | null
      businessHours?: BusinessHourInput[]
    }>
  ) {
    const { businessHours, ...settingsData } = data

    // 🔒 VALIDAÇÃO DE PLANO (Feature Gating)
    // Se o usuário está tentando ativar o lembrete, verificamos o plano.
    if (settingsData.reminderEnabled === true) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { plan: true },
      })

      const plan = tenant?.plan?.toUpperCase() || 'FREE'
      // Planos permitidos (Regra de Negócio)
      const allowedPlans = ['SECONDARY', 'THIRD', 'UNLIMITED']

      if (!allowedPlans.includes(plan)) {
        // Bloqueia a ação e retorna erro 403
        throw Errors.Forbidden(
          'Recurso exclusivo: Lembretes automáticos disponíveis apenas a partir do plano SECONDARY.'
        )
      }
    }

    // 1. Atualiza configurações
    const settings = await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...settingsData } as Parameters<
        typeof prisma.tenantSettings.upsert
      >[0]['create'],
      update: settingsData as Parameters<typeof prisma.tenantSettings.upsert>[0]['update'],
    })

    // 2. Atualiza Horários
    if (businessHours && Array.isArray(businessHours)) {
      await prisma.$transaction(
        businessHours.map((hour: BusinessHourInput) =>
          prisma.businessHour.upsert({
            where: {
              tenantId_dayOfWeek: { tenantId, dayOfWeek: hour.dayOfWeek },
            },
            create: {
              tenantId,
              dayOfWeek: hour.dayOfWeek,
              startTime: hour.startTime,
              endTime: hour.endTime,
              isOpen: hour.isOpen,
            },
            update: {
              startTime: hour.startTime,
              endTime: hour.endTime,
              isOpen: hour.isOpen,
            },
          })
        )
      )
    }

    return this.getTenantSettings(tenantId)
  }

  // --- User Settings ---
  async getUserSettings(userId: string) {
    return prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    })
  }

  async updateUserSettings(
    userId: string,
    data: Partial<{ theme?: string; notifications?: boolean }>
  ) {
    return prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
  }
}
