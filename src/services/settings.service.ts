// src/services/settings.service.ts
import { Errors } from '../lib/errors' // ✅ Importante
import { prisma } from '../lib/prisma'

interface BusinessHourInput {
  dayOfWeek: number
  startTime: string
  endTime: string
  isOpen: boolean
}

export class SettingsService {
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
