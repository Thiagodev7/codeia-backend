import { Content, GoogleGenerativeAI, SchemaType, Tool } from '@google/generative-ai'
import { addMinutes, startOfMinute } from 'date-fns'
import { env } from '../lib/env'
import { Errors } from '../lib/errors'
import { logger } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { AppointmentService } from './appointment.service'

// --- Interfaces & Tipos ---

interface ChatContext {
  tenantId: string
  customerId: string
  customerPhone: string
  customerName: string
}

interface ChatResult {
  response: string | null
  action?: string
}

interface ToolExecutionResult {
  status: 'success' | 'error'
  message: string
}

// --- Funções Auxiliares (Helpers) ---

function normalizeString(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Converte o JSON de horários do banco para texto legível.
 */
function formatBusinessHours(
  schedule: Record<string, { open: boolean; start: string; end: string }> | null
): string {
  if (!schedule) return 'Horário não configurado (Consulte o suporte).'

  const dayMap: Record<string, string> = {
    mon: 'Segunda-feira',
    tue: 'Terça-feira',
    wed: 'Quarta-feira',
    thu: 'Quinta-feira',
    fri: 'Sexta-feira',
    sat: 'Sábado',
    sun: 'Domingo',
  }

  const orderedKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

  const lines = orderedKeys.map((key) => {
    const dayConfig = schedule[key]
    const dayName = dayMap[key] || key

    if (!dayConfig || dayConfig.open === false) {
      return `- ${dayName}: Fechado 🚫`
    }

    return `- ${dayName}: ${dayConfig.start} às ${dayConfig.end} ✅`
  })

  return lines.join('\n      ')
}

// Definição das ferramentas
const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'createAppointment',
        description: 'Agendar um NOVO compromisso.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            serviceName: { type: SchemaType.STRING, description: 'Nome do serviço.' },
            dateTime: {
              type: SchemaType.STRING,
              description: 'Data e Hora ISO 8601 COM FUSO (ex: 2024-12-01T14:00:00-03:00).',
            },
            clientName: { type: SchemaType.STRING, description: 'Nome do cliente.' },
            clientPhone: { type: SchemaType.STRING, description: 'Telefone do cliente.' },
          },
          required: ['serviceName', 'dateTime'],
        },
      },
      {
        name: 'listMyAppointments',
        description: 'Listar agendamentos futuros.',
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'cancelAppointment',
        description: 'Cancelar agendamento.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: { appointmentId: { type: SchemaType.STRING } },
          required: ['appointmentId'],
        },
      },
      {
        name: 'rescheduleAppointment',
        description: 'Reagendar compromisso.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            appointmentId: { type: SchemaType.STRING },
            newDateTime: { type: SchemaType.STRING },
          },
          required: ['appointmentId', 'newDateTime'],
        },
      },
    ],
  },
]

export class AIService {
  private genAI: GoogleGenerativeAI
  private appointmentService = new AppointmentService()

  private readonly MODEL_NAME = 'gemini-2.0-flash-lite'

  constructor() {
    this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  }

  // --- ENGINE DE CHAT ---

  async chat(
    agentId: string,
    userMessage: string,
    context: ChatContext,
    history: Content[] = []
  ): Promise<ChatResult> {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || !agent.isActive) return { response: null }

    // 1. Configurações (Fuso Horário e Horários de Funcionamento)
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: context.tenantId },
    })

    const businessHours = await prisma.businessHour.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { dayOfWeek: 'asc' },
    })

    // 2. Serviços (convertendo Decimal para number)
    const servicesData = await prisma.service.findMany({
      where: { tenantId: context.tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        duration: true,
        price: true,
        description: true,
        aiDescription: true,
      },
    })
    const services = servicesData.map((s) => ({ ...s, price: Number(s.price) }))

    // 3. Prompt (Com injeção de Timezone correta)
    const systemPrompt = this.buildSystemPrompt(
      agent.instructions,
      context,
      services,
      settings,
      businessHours
    )

    const model = this.genAI.getGenerativeModel({
      model: this.MODEL_NAME,
      systemInstruction: systemPrompt,
      tools: toolsDef,
    })

    const chatSession = model.startChat({ history })

    try {
      const result = await chatSession.sendMessage(userMessage)
      const response = result.response

      // ✅ Registrar Uso (Async)
      if (response.usageMetadata) {
        this.saveUsage(context, agent.id, response.usageMetadata)
      }

      const functionCalls = response.functionCalls()

      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0]
        const toolResult = await this.handleToolCall(
          call.name,
          (call.args || {}) as Record<string, unknown>,
          context,
          services,
          businessHours
        )

        const nextPart = await chatSession.sendMessage([
          {
            functionResponse: { name: call.name, response: toolResult },
          },
        ])

        // ✅ Registrar Uso da Resposta da Função (Async)
        if (nextPart.response.usageMetadata) {
          this.saveUsage(context, agent.id, nextPart.response.usageMetadata)
        }

        const modelResponse = nextPart.response.text()

        // FAILSAFE: Se o modelo ficar silêncio após a ferramenta, usamos a msg da ferramenta
        const finalResponse =
          modelResponse ||
          (typeof toolResult.message === 'string'
            ? toolResult.message
            : 'Ação concluída com sucesso.')

        return { response: finalResponse, action: call.name }
      }

      return { response: response.text() }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error({ error: errorMessage }, '❌ Falha no Chat IA')
      throw Errors.Internal('Erro no Serviço de IA.')
    }
  }

  // --- MÉTODOS PRIVADOS ---

  private buildSystemPrompt(
    instructions: string,
    context: ChatContext,
    services: {
      id: string
      name: string
      duration: number
      price: number
      aiDescription?: string | null
    }[],
    settings: {
      timezone?: string | null
      allowGenericServices?: boolean
      genericServiceDuration?: number
      aiKnowledge?: string | null
      [key: string]: unknown
    } | null,
    businessHours: { dayOfWeek: number; startTime: string; endTime: string; isOpen: boolean }[]
  ): string {
    const servicesList = services
      .map((s) => {
        const desc = s.aiDescription ? `\n      > 📝 Regra: ${s.aiDescription}` : ''
        return `🔹 ${s.name} (${s.duration}min) - R$ ${Number(s.price).toFixed(2)}${desc}`
      })
      .join('\n')

    // Lógica de Serviços Genéricos
    let genericServiceInstruction =
      '⚠️ Você só pode agendar os serviços listados acima. Se o cliente pedir algo fora da lista, diga educadamente que não oferecem este serviço.'

    if (settings?.allowGenericServices) {
      const duration = settings.genericServiceDuration || 30
      genericServiceInstruction = `✅ Você PODE agendar serviços não listados acima (ex: Barba, Sobrancelha). 
      Para serviços não listados, use o nome que o cliente pediu e considere a duração padrão de ${duration} minutos.
      Se o cliente perguntar o preço, diga que é sob consulta no local.`
    }

    // FORMATAÇÃO DE HORÁRIOS
    // Se o novo formato array vier do banco, converte para objeto ou usa direto.
    // Aqui assumimos que 'settings.businessHours' pode ser o array da tabela nova ou json antigo.
    // Para simplificar, vou usar o helper formatBusinessHours que fizemos antes.
    let hoursText = 'Consulte disponibilidade.'
    if (Array.isArray(businessHours) && businessHours.length > 0) {
      // Se vier da tabela nova (Array)
      const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
      hoursText = businessHours
        .map((h) => {
          const day = DAY_NAMES[h.dayOfWeek]
          return h.isOpen ? `- ${day}: ${h.startTime} às ${h.endTime} ✅` : `- ${day}: Fechado 🚫`
        })
        .join('\n      ')
    } else {
      // Fallback para JSON antigo (se houver migração pendente)
      hoursText = formatBusinessHours(
        (
          settings as {
            businessHours?: Record<string, { open: boolean; start: string; end: string }> | null
          }
        )?.businessHours || null
      )
    }

    // --- CORREÇÃO DE DATA/FUSO ---
    const timeZone = settings?.timezone || 'America/Sao_Paulo'

    // Data formatada explicitamente no fuso da empresa
    const now = new Date()
    const dateStr = now.toLocaleDateString('pt-BR', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const timeStr = now.toLocaleTimeString('pt-BR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    })

    const companyInfo = settings
      ? `
      - Empresa: ${settings.businessName || 'Não informado'}
      - Endereço: ${settings.address || 'Não informado'}
      
      🕒 HORÁRIOS DE ATENDIMENTO:
      ${hoursText}
    `
      : 'Sem dados da empresa.'

    return `
      === 🤖 PERSONA ===
      ${instructions}

      === 🏢 EMPRESA (Fuso: ${timeZone}) ===
      ${companyInfo}

      === 👤 CLIENTE ===
      Nome: ${context.customerName}

      === 💰 SERVIÇOS ===
      📋 LISTA DE SERVIÇOS DISPONÍVEIS:
      ${servicesList || 'Nenhum serviço cadastrado.'}

      ${genericServiceInstruction}

      === 🛠️ FERRAMENTAS ESPECIAIS (VOCÊ TEM PODERES) ===
      Você possui ferramentas poderosas para gerenciar a agenda. USE-AS SEMPRE QUE NECESSÁRIO:
      1. **VER AGENDAMENTOS:** Se o cliente perguntar "Tenho horário?" ou "Quando agendei?", execute \`listMyAppointments\`. Não diga que não sabe/não pode. Você PODE.
      2. **CANCELAR:** Se o cliente pedir para cancelar, execute \`cancelAppointment\`.
      3. **REAGENDAR:** Se o cliente quiser mudar o horário, execute \`rescheduleAppointment\`.
      
      > **🚫 REGRA DE OURO (UX): NUNCA PEÇA O ID PARA O CLIENTE.**
      > O cliente não sabe o ID. Se ele pedir para cancelar "o das 18h", você deve:
      > 1. Executar \`listMyAppointments\` (se já não tiver a lista recente).
      > 2. Procurar na lista qual agendamento é às 18h.
      > 3. Pegar o ID dele internamente.
      > 4. Executar \`cancelAppointment\` usando esse ID que você encontrou.
      > Se houver ambiguidade (dois horários iguais), liste as opções para ele confirmar (sem mostrar IDs, mostre datas/serviços).

      ${
        settings?.aiKnowledge
          ? `
      === 🧠 CONHECIMENTO DO NEGÓCIO (FONTE DA VERDADE) ===
      As informações abaixo são FATOS sobre este estabelecimento.
      Se o texto mencionar nomes de profissionais (ex: "O Thiago atende"), assuma que É ELE quem realizará o serviço.
      
      ${settings.aiKnowledge}
      `
          : ''
      }

      === 🚨 REGRAS DE DATA E HORA (CRÍTICO) ===
      1. **Hoje é:** ${dateStr}.
      2. **Hora atual:** ${timeStr}.
      3. Ao agendar, calcule a data futura corretamente.
      4. **IMPORTANTE:** Ao chamar a função 'createAppointment', envie a data no formato ISO 8601 COMPLETO COM OFFSET do fuso horário.
         - Exemplo Correto: 2026-05-02T14:00:00-03:00 (Isso garante que o servidor entenda que é horário do Brasil).
         - Exemplo Errado: 2026-05-02T14:00:00 (Isso será tratado como UTC e causará erro de "data passada").
    `
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    context: ChatContext,
    services: { id: string; name: string; duration: number }[],
    businessHours: { dayOfWeek: number; startTime: string; endTime: string; isOpen: boolean }[]
  ): Promise<ToolExecutionResult> {
    try {
      if (name === 'checkAvailability') {
        const { date } = args as { date: string }
        return await this.checkAvailability(context.tenantId, date, businessHours)
      }

      switch (name) {
        case 'listMyAppointments': {
          const apps = await this.appointmentService.listUpcoming(
            context.tenantId,
            context.customerId
          )

          if (!apps.length) {
            return { status: 'success', message: 'Nenhum agendamento futuro encontrado.' }
          }

          // Formata para a IA entender claramente, mesmo sem 'service' lincado
          const formattedList = apps
            .map((app) => {
              const dateStr = app.startTime.toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                weekday: 'long',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
              return `- ID: ${app.id}\n  Serviço: ${app.title}\n  Quando: ${dateStr}`
            })
            .join('\n\n')

          return {
            status: 'success',
            message: `Aqui estão os agendamentos encontrados:\n\n${formattedList}`,
          }
        }
        case 'cancelAppointment': {
          const appointmentId =
            typeof args.appointmentId === 'string' ? args.appointmentId : String(args.appointmentId)
          await this.appointmentService.cancelAppointment(
            context.tenantId,
            context.customerId,
            appointmentId
          )
          return { status: 'success', message: 'Cancelado.' }
        }
        case 'rescheduleAppointment': {
          const appointmentId =
            typeof args.appointmentId === 'string' ? args.appointmentId : String(args.appointmentId)
          const newDateTime =
            typeof args.newDateTime === 'string' ? args.newDateTime : String(args.newDateTime)

          const targetDate = new Date(newDateTime)

          // Validação extra de segurança
          if (isNaN(targetDate.getTime())) {
            return { status: 'error', message: 'Data/Hora inválida.' }
          }

          // --- VALIDAÇÃO RÍGIDA DE HORÁRIO DE FUNCIONAMENTO ---
          const dayOfWeek = targetDate.getDay()
          const hourConfig = businessHours.find((h) => h.dayOfWeek === dayOfWeek)

          if (!hourConfig || !hourConfig.isOpen) {
            return {
              status: 'error',
              message: `Erro: O estabelecimento está fechado neste dia (${targetDate.toLocaleDateString('pt-BR', { weekday: 'long' })}).`,
            }
          }

          const timeString = targetDate.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
          })

          if (timeString < hourConfig.startTime || timeString > hourConfig.endTime) {
            return {
              status: 'error',
              message: `Erro: Horário indisponível. O funcionamento é das ${hourConfig.startTime} às ${hourConfig.endTime}.`,
            }
          }
          // ----------------------------------------------------

          const updated = await this.appointmentService.rescheduleAppointment(
            context.tenantId,
            appointmentId,
            targetDate,
            context.customerId
          )
          return {
            status: 'success',
            message: `Reagendado para ${updated.startTime.toLocaleString('pt-BR')}.`,
          }
        }
        case 'createAppointment': {
          const serviceName =
            typeof args.serviceName === 'string' ? args.serviceName : String(args.serviceName || '')
          const dateTime = typeof args.dateTime === 'string' ? args.dateTime : String(args.dateTime)
          const inputName = normalizeString(serviceName)
          const service = services.find((s) => normalizeString(s.name).includes(inputName))

          // Conversão segura de data
          const appointmentDate = new Date(dateTime)

          // Validação extra de segurança antes de chamar o service
          if (isNaN(appointmentDate.getTime())) {
            return { status: 'error', message: 'Data inválida. Tente novamente.' }
          }

          const clientName = args.clientName ? String(args.clientName) : context.customerName
          const clientPhone = args.clientPhone ? String(args.clientPhone) : context.customerPhone

          const app = await this.appointmentService.createAppointment({
            tenantId: context.tenantId,
            customerId: context.customerId,
            serviceId: service?.id,
            title: service?.name || serviceName,
            startTime: appointmentDate,
            clientName,
            clientPhone,
          })
          return {
            status: 'success',
            message: `Agendado: ${app.title} em ${app.startTime.toLocaleString('pt-BR')}`,
          }
        }
        default:
          return { status: 'error', message: 'Ferramenta desconhecida.' }
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : ''
      if (errMsg.includes('passado')) {
        return {
          status: 'error',
          message:
            'Erro de fuso horário: O sistema achou que esse horário já passou. Por favor, tente um horário um pouco mais tarde.',
        }
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro ao processar'
      return { status: 'error', message: errorMessage }
    }
  }

  // --- FERRAMENTAS INTERNAS (CUSTOM) ---

  private async checkAvailability(
    tenantId: string,
    dateStr: string,
    businessHours: { dayOfWeek: number; startTime: string; endTime: string; isOpen: boolean }[]
  ): Promise<ToolExecutionResult> {
    try {
      const requestedDate = new Date(dateStr)
      if (isNaN(requestedDate.getTime())) return { status: 'error', message: 'Data inválida.' }

      const dayOfWeek = requestedDate.getDay() // 0 = Domingo
      const hourConfig = businessHours.find((h) => h.dayOfWeek === dayOfWeek)

      if (!hourConfig || !hourConfig.isOpen) {
        return { status: 'success', message: 'Estamos fechados neste dia.' }
      }

      // Verificação simples de horário (HH:mm)
      const timeString = requestedDate.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })
      // Ajuste simples para comparação de string de hora
      // Nota: Idealmente usaríamos date-fns para comparação de hora, mas string compare funciona para formato HH:mm fixo
      if (timeString < hourConfig.startTime || timeString > hourConfig.endTime) {
        return {
          status: 'success',
          message: `Fora do horário de atendimento (${hourConfig.startTime} - ${hourConfig.endTime}).`,
        }
      }

      // Verificar conflito de agendamento
      const startTime = startOfMinute(requestedDate)
      const endTime = addMinutes(startTime, 30)

      const conflict = await prisma.appointment.findFirst({
        where: {
          tenantId,
          status: 'SCHEDULED',
          AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
        },
      })

      if (conflict) {
        return { status: 'success', message: 'Horário indisponível (já reservado).' }
      }

      return { status: 'success', message: 'Horário disponível!' }
    } catch (e) {
      return { status: 'error', message: 'Erro ao verificar disponibilidade.' }
    }
  }

  // --- REGISTRO DE USO ---
  private async saveUsage(
    context: ChatContext,
    agentId: string,
    usage: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number }
  ) {
    try {
      await prisma.usageRecord.create({
        data: {
          tenantId: context.tenantId,
          agentId: agentId,
          customerId: context.customerId,
          model: this.MODEL_NAME,
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount || 0,
          totalTokens: usage.totalTokenCount,
        },
      })
    } catch (error) {
      logger.error({ error }, '❌ Erro ao salvar registro de uso de tokens')
    }
  }

  // (Métodos auxiliares CRUD de agentes mantidos iguais ao original)
  async createAgent(
    tenantId: string,
    data: { name: string; slug: string; instructions: string; model?: string }
  ) {
    const existing = await prisma.agent.findUnique({
      where: { tenantId_slug: { tenantId, slug: data.slug } },
    })
    if (existing) throw Errors.Conflict(`Slug "${data.slug}" já existe.`)
    const activeCount = await prisma.agent.count({ where: { tenantId, isActive: true } })
    return prisma.agent.create({
      data: { tenantId, ...data, model: this.MODEL_NAME, isActive: activeCount === 0 },
    })
  }
  async updateAgent(
    tenantId: string,
    agentId: string,
    data: Partial<{
      name: string
      slug: string
      instructions: string
      model: string
      isActive: boolean
    }>
  ) {
    return prisma.agent.update({ where: { id: agentId }, data })
  }
  async deleteAgent(tenantId: string, agentId: string) {
    return prisma.agent.delete({ where: { id: agentId } })
  }
}
