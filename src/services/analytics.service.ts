import { subDays } from 'date-fns'
import { prisma } from '../lib/prisma'

interface ChartData {
  name: string
  value: number
}

interface DashboardStats {
  customers: number
  messages: number
  appointments: number
  users: number
}

export class AnalyticsService {
  /**
   * Retorna contagens gerais para os cards do dashboard
   */
  async getDashboardStats(tenantId: string): Promise<DashboardStats> {
    const [customers, messages, appointments, users] = await Promise.all([
      prisma.customer.count({ where: { tenantId } }),
      prisma.message.count({ where: { tenantId } }),
      prisma.appointment.count({ where: { tenantId } }),
      prisma.user.count({ where: { tenantId } }),
    ])

    return { customers, messages, appointments, users }
  }

  /**
   * Retorna dados para o gráfico de agendamentos (últimos 7 dias)
   */
  async getAppointmentsChart(tenantId: string): Promise<ChartData[]> {
    const sevenDaysAgo = subDays(new Date(), 7)

    // Agrupa por data (dia/mês) e conta
    const result = await prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT 
        TO_CHAR("startTime", 'DD/MM') as date,
        COUNT(*)::int as count
      FROM "appointments"
      WHERE "tenantId" = ${tenantId}
        AND "startTime" >= ${sevenDaysAgo}
      GROUP BY TO_CHAR("startTime", 'DD/MM'), "startTime"::date
      ORDER BY "startTime"::date ASC
    `

    return result.map((r) => ({
      name: r.date,
      value: Number(r.count),
    }))
  }

  /**
   * Retorna dados para o gráfico de mensagens (últimos 7 dias)
   */
  async getMessagesChart(tenantId: string): Promise<ChartData[]> {
    const sevenDaysAgo = subDays(new Date(), 7)

    const result = await prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT 
        TO_CHAR("createdAt", 'DD/MM') as date,
        COUNT(*)::int as count
      FROM "messages"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ${sevenDaysAgo}
      GROUP BY TO_CHAR("createdAt", 'DD/MM'), "createdAt"::date
      ORDER BY "createdAt"::date ASC
    `

    return result.map((r) => ({
      name: r.date,
      value: Number(r.count),
    }))
  }
}
