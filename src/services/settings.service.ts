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
      update: {}
    })

    // Retorna os horários ordenados (0=Dom, 1=Seg...)
    const businessHours = await prisma.businessHour.findMany({
      where: { tenantId },
      orderBy: { dayOfWeek: 'asc' }
    })

    return { ...settings, businessHours }
  }

  async updateTenantSettings(tenantId: string, data: any) {
    // Separa os horários dos outros dados
    const { businessHours, ...settingsData } = data

    // 1. Salva dados simples
    const settings = await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...settingsData },
      update: settingsData
    })

    // 2. Salva horários (Upsert em lote)
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