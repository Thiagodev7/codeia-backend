// src/services/settings.service.ts
import { prisma } from '../lib/prisma'
import { Errors } from '../lib/errors' // ✅ Importante

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
      update: {}
    })

    const businessHours = await prisma.businessHour.findMany({
      where: { tenantId },
      orderBy: { dayOfWeek: 'asc' }
    })

    return { ...settings, businessHours }
  }

  async updateTenantSettings(tenantId: string, data: any) {
    const { businessHours, ...settingsData } = data

    // 🔒 VALIDAÇÃO DE PLANO (Feature Gating)
    // Se o usuário está tentando ativar o lembrete, verificamos o plano.
    if (settingsData.reminderEnabled === true) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { plan: true }
      })

      const plan = tenant?.plan?.toUpperCase() || 'FREE'
      // Planos permitidos (Regra de Negócio)
      const allowedPlans = ['SECONDARY', 'THIRD', 'UNLIMITED']

      if (!allowedPlans.includes(plan)) {
        // Bloqueia a ação e retorna erro 403
        throw Errors.Forbidden('Recurso exclusivo: Lembretes automáticos disponíveis apenas a partir do plano SECONDARY.')
      }
    }

    // 1. Atualiza configurações
    const settings = await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...settingsData },
      update: settingsData
    })

    // 2. Atualiza Horários
    if (businessHours && Array.isArray(businessHours)) {
      await prisma.$transaction(
        businessHours.map((hour: BusinessHourInput) => 
          prisma.businessHour.upsert({
            where: { 
              tenantId_dayOfWeek: { tenantId, dayOfWeek: hour.dayOfWeek } 
            },
            create: {
              tenantId,
              dayOfWeek: hour.dayOfWeek,
              startTime: hour.startTime,
              endTime: hour.endTime,
              isOpen: hour.isOpen
            },
            update: {
              startTime: hour.startTime,
              endTime: hour.endTime,
              isOpen: hour.isOpen
            }
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
      update: {}
    })
  }

  async updateUserSettings(userId: string, data: any) {
    return prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data
    })
  }
}