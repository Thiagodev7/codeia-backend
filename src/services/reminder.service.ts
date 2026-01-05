import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { WhatsAppManager } from './whatsapp-manager.service'
import { subMinutes, addMinutes } from 'date-fns'

export class ReminderService {
  private static intervalId: NodeJS.Timeout | null = null

  static start() {
    if (this.intervalId) return
    
    logger.info('⏰ [Reminder] Serviço de lembretes INICIADO. Verificando a cada 60s...')
    
    // Roda imediatamente ao iniciar para testar
    this.checkAndSendReminders()

    // Loop a cada 60s
    this.intervalId = setInterval(async () => {
      await this.checkAndSendReminders()
    }, 60000)
  }

  private static async checkAndSendReminders() {
    try {
      const now = new Date()
      const waManager = WhatsAppManager.getInstance()

      // Log de pulso (Heartbeat) - Útil para saber que o cron não morreu
      // (Comentado para não poluir demais, mas descomente se quiser ver cada minuto)
       logger.info('💓 [Reminder] Verificando agendamentos...')

      const settingsWithReminders = await prisma.tenantSettings.findMany({
        where: { reminderEnabled: true }
      })

      if (settingsWithReminders.length === 0) {
         logger.debug('💤 Nenhuma empresa tem lembretes ativados.')
        return
      }

      for (const setting of settingsWithReminders) {
        const minutes = setting.reminderMinutes
        const targetTimeStart = addMinutes(now, minutes - 2)
        const targetTimeEnd = addMinutes(now, minutes + 2)

        const appointments = await prisma.appointment.findMany({
          where: {
            tenantId: setting.tenantId,
            status: 'SCHEDULED',
            reminderSent: false,
            startTime: {
              gte: targetTimeStart,
              lte: targetTimeEnd
            }
          },
          include: { customer: true }
        })

        if (appointments.length > 0) {
            logger.info({ 
                tenantId: setting.tenantId, 
                count: appointments.length 
            }, `🎯 Encontrados ${appointments.length} agendamentos para lembrar agora!`)
        }

        for (const app of appointments) {
          const phone = app.customer.phone
          const timeString = app.startTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          
          const message = `🔔 *Lembrete Automático*\n\nOlá ${app.customer.name || 'Cliente'}! Lembrete do seu agendamento hoje às *${timeString}*.\n\nResponda se precisar reagendar. Até logo!`

          logger.info({ appointmentId: app.id, phone }, '🚀 Enviando mensagem de lembrete...')
          
          const sent = await waManager.sendTextMessage(setting.tenantId, phone, message)

          if (sent) {
            await prisma.appointment.update({
              where: { id: app.id },
              data: { reminderSent: true }
            })
            logger.info({ appointmentId: app.id }, '✅ Lembrete marcado como enviado no banco.')
          } else {
            logger.error({ appointmentId: app.id }, '❌ Falha no envio do lembrete (Sessão desconectada?)')
          }
        }
      }
    } catch (error) {
      logger.error({ error }, '❌ CRASH no loop de lembretes')
    }
  }
}