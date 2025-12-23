// src/services/settings.service.ts
import { prisma } from '../lib/prisma'

// Interfaces para tipagem dos dados de entrada
interface UpdateTenantSettingsInput {
  primaryColor?: string
  logoUrl?: string
  timezone?: string
  businessHours?: any // JSON flexível
}

interface UpdateUserSettingsInput {
  theme?: string
  language?: string
  emailAlerts?: boolean
  whatsappAlerts?: boolean
}

/**
 * Service de Configurações
 * Gerencia preferências globais da empresa (Tenant) e individuais do usuário.
 */
export class SettingsService {
  
  // --- TENANT SETTINGS (Configurações da Empresa) ---

  /**
   * Busca as configurações da empresa.
   * Se não existirem, cria com os valores padrão definidos no Schema.
   */
  async getTenantSettings(tenantId: string) {
    return prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId }, // Cria padrão se não existir
      update: {}            // Não faz nada se já existir
    })
  }

  /**
   * Atualiza as configurações da empresa.
   */
  async updateTenantSettings(tenantId: string, data: UpdateTenantSettingsInput) {
    return prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { 
        tenantId,
        ...data
      },
      update: data
    })
  }

  // --- USER SETTINGS (Preferências do Usuário) ---

  /**
   * Busca as preferências do usuário logado.
   */
  async getUserSettings(userId: string) {
    return prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {}
    })
  }

  /**
   * Atualiza as preferências do usuário logado.
   */
  async updateUserSettings(userId: string, data: UpdateUserSettingsInput) {
    return prisma.userSettings.upsert({
      where: { userId },
      create: { 
        userId, 
        ...data 
      },
      update: data
    })
  }
}