/**
 * Reminder Worker
 * 
 * Worker dedicado que processa jobs de lembrete via BullMQ.
 * Usa cron job (a cada minuto) para verificar agendamentos
 * e enviar lembretes via WhatsApp.
 * 
 * Vantagens sobre setInterval:
 * - Apenas uma instância processa cada job (sem duplicação)
 * - Jobs persistem no Redis
 * - Retry automático em caso de falha
 * 
 * @module services/reminder.worker
 */
import { Job, Worker } from 'bullmq'
import { addMinutes } from 'date-fns'

import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { ReminderJobData, reminderQueue } from '../lib/queues'
import { redis } from '../lib/redis'
import { WhatsAppManager } from './whatsapp-manager.service'

// ---------------------------------------------------------------------------
// Reminder Worker Class
// ---------------------------------------------------------------------------

export class ReminderWorker {
  private worker: Worker<ReminderJobData>

  constructor() {
    this.worker = new Worker<ReminderJobData>(
      'reminder',
      this.processJob.bind(this),
      { 
        connection: redis,
        concurrency: 1 // Apenas 1 job por vez (evita race conditions)
      }
    )

    this.worker.on('completed', (job) => {
      logger.debug({ jobId: job.id }, '✅ Job de lembrete concluído')
    })

    this.worker.on('failed', (job, error) => {
      logger.error({ jobId: job?.id, error: error.message }, '❌ Job de lembrete falhou')
    })

    // Registra job repetitivo
    this.scheduleRepeatingJob()
    
    logger.info('⏰ Reminder Worker iniciado e aguardando jobs...')
  }

  // ---------------------------------------------------------------------------
  // Agendamento do Cron Job
  // ---------------------------------------------------------------------------

  /**
   * Registra job que executa a cada minuto
   */
  private async scheduleRepeatingJob(): Promise<void> {
    try {
      // Remove jobs repetitivos antigos (evita duplicação)
      const existingJobs = await reminderQueue.getRepeatableJobs()
      for (const job of existingJobs) {
        await reminderQueue.removeRepeatableByKey(job.key)
      }

      // Adiciona novo job repetitivo: a cada minuto
      await reminderQueue.add(
        'check-reminders',
        { type: 'CHECK_REMINDERS' },
        { 
          repeat: { 
            pattern: '* * * * *' // Cron: a cada minuto
          },
          jobId: 'reminder-cron' // ID fixo para evitar duplicação
        }
      )

      logger.info('📅 Cron job de lembretes registrado: execução a cada minuto')
    } catch (error: any) {
      logger.error({ error: error.message }, '❌ Erro ao registrar cron job')
    }
  }

  // ---------------------------------------------------------------------------
  // Processamento de Jobs
  // ---------------------------------------------------------------------------

  private async processJob(job: Job<ReminderJobData>): Promise<void> {
    if (job.data.type === 'CHECK_REMINDERS') {
      await this.checkAndSendReminders()
    }
  }

  /**
   * Verifica agendamentos próximos e envia lembretes
   */
  private async checkAndSendReminders(): Promise<void> {
    try {
      const now = new Date()
      const waManager = WhatsAppManager.getInstance()

      logger.debug('💓 [Reminder] Verificando agendamentos...')

      // Busca tenants com lembretes habilitados
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

        // Busca agendamentos que precisam de lembrete
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
          }, `🎯 Encontrados ${appointments.length} agendamentos para lembrar!`)
        }

        // Envia lembretes
        for (const app of appointments) {
          await this.sendReminder(waManager, setting.tenantId, app)
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message }, '❌ Erro no processamento de lembretes')
      throw error // Re-throw para BullMQ registrar falha
    }
  }

  /**
   * Envia lembrete individual
   */
  private async sendReminder(
    waManager: WhatsAppManager, 
    tenantId: string, 
    appointment: any
  ): Promise<void> {
    const phone = appointment.customer.phone
    const timeString = appointment.startTime.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
    
    const message = `🔔 *Lembrete Automático*\n\nOlá ${appointment.customer.name || 'Cliente'}! Lembrete do seu agendamento hoje às *${timeString}*.\n\nResponda se precisar reagendar. Até logo!`

    logger.info({ appointmentId: appointment.id, phone }, '🚀 Enviando lembrete...')
    
    const sent = await waManager.sendTextMessage(tenantId, phone, message)

    if (sent) {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { reminderSent: true }
      })
      logger.info({ appointmentId: appointment.id }, '✅ Lembrete enviado!')
    } else {
      logger.warn({ appointmentId: appointment.id }, '⚠️ Falha no envio (sessão desconectada?)')
    }
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    logger.info('🛑 Parando Reminder Worker...')
    await this.worker.close()
    logger.info('✅ Reminder Worker parado')
  }
}
