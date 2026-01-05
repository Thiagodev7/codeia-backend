import { GoogleGenerativeAI, Tool, Content, SchemaType } from '@google/generative-ai'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AppointmentService } from './appointment.service'
import { Errors } from '../lib/errors'

// --- Interfaces ---
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

// --- Helpers ---
function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const DAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

/**
 * Converte o array de BusinessHour (banco) para texto legível.
 */
function formatBusinessHours(hours: any[]): string {
  if (!hours || hours.length === 0) return "Horários não configurados (Consulte o suporte).";

  // Reordenar para começar na Segunda (1) e Domingo (0) no final, se preferir visualmente,
  // mas aqui vamos iterar pela ordem natural do JS (0-6) ou confiar na ordem do banco.
  
  const lines = hours.map(h => {
    const dayName = DAY_NAMES[h.dayOfWeek] || `Dia ${h.dayOfWeek}`;
    
    if (!h.isOpen) {
      return `- ${dayName}: Fechado 🚫`;
    }
    return `- ${dayName}: ${h.startTime} às ${h.endTime} ✅`;
  });

  return lines.join('\n      ');
}

// --- Tools Def ---
const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "createAppointment",
        description: "Agendar um NOVO compromisso.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            serviceName: { type: SchemaType.STRING },
            dateTime: { type: SchemaType.STRING },
            clientName: { type: SchemaType.STRING },
            clientPhone: { type: SchemaType.STRING }
          },
          required: ["serviceName", "dateTime"]
        }
      },
      {
        name: "listMyAppointments",
        description: "Listar agendamentos futuros.",
        parameters: { type: SchemaType.OBJECT, properties: {} }
      },
      {
        name: "cancelAppointment",
        description: "Cancelar agendamento.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { appointmentId: { type: SchemaType.STRING } },
            required: ["appointmentId"]
        }
      },
      {
        name: "rescheduleAppointment",
        description: "Reagendar compromisso.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { appointmentId: { type: SchemaType.STRING }, newDateTime: { type: SchemaType.STRING } },
            required: ["appointmentId", "newDateTime"]
        }
      }
    ]
  }
]

export class AIService {
  private genAI: GoogleGenerativeAI
  private appointmentService = new AppointmentService()
  private readonly MODEL_NAME = "gemini-2.0-flash-lite"; 

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('❌ GEMINI_API_KEY ausente')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  // --- Chat Principal ---
  async chat(agentId: string, userMessage: string, context: ChatContext, history: Content[] = []): Promise<ChatResult> {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || !agent.isActive) return { response: null }

    // 1. Busca Settings (Info básica)
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: context.tenantId } })

    // 2. Busca Horários (Tabela Nova)
    const businessHours = await prisma.businessHour.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { dayOfWeek: 'asc' } // 0=Dom, 1=Seg...
    })

    // 3. Busca Serviços
    const services = await prisma.service.findMany({
      where: { tenantId: context.tenantId, isActive: true },
      select: { id: true, name: true, duration: true, price: true, description: true }
    })

    const systemPrompt = this.buildSystemPrompt(agent.instructions, context, services, settings, businessHours);

    const model = this.genAI.getGenerativeModel({ 
      model: this.MODEL_NAME,
      systemInstruction: systemPrompt,
      tools: toolsDef
    })

    const chatSession = model.startChat({ history })

    try {
      const result = await chatSession.sendMessage(userMessage)
      const response = result.response
      const functionCalls = response.functionCalls()
      
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0]
        const toolResult = await this.handleToolCall(call.name, call.args, context, services)
        const nextPart = await chatSession.sendMessage([{ functionResponse: { name: call.name, response: toolResult } }])
        return { response: nextPart.response.text(), action: call.name }
      }
      return { response: response.text() }
    } catch (error: any) {
      logger.error({ error: error.message }, '❌ Falha no Chat IA')
      throw Errors.Internal("Erro no Serviço de IA.")
    }
  }

  private buildSystemPrompt(instructions: string, context: ChatContext, services: any[], settings: any, businessHours: any[]): string {
    const servicesList = services.map(s => `🔹 ${s.name} (${s.duration}min) - R$ ${Number(s.price).toFixed(2)}`).join('\n');
    
    // Formata usando a nova tabela
    const formattedHours = formatBusinessHours(businessHours);

    const companyInfo = settings ? `
      - Empresa: ${settings.businessName || 'Não informado'}
      - Endereço: ${settings.address || 'Não informado'}
      - Telefone: ${settings.contactPhone || 'Não informado'}
      
      🕒 HORÁRIOS DE ATENDIMENTO:
      ${formattedHours}
    ` : "Sem dados da empresa.";

    return `
      === 🤖 PERSONA ===
      ${instructions}

      === 🏢 EMPRESA ===
      ${companyInfo}

      === 👤 CLIENTE ===
      Nome: ${context.customerName}

      === 💰 SERVIÇOS ===
      ${servicesList || "Nenhum serviço cadastrado."}

      === 🚨 REGRAS ===
      1. Respeite os horários acima. Se "Fechado 🚫", não agende.
      2. Hoje: ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}.
    `
  }

  // (createAgent, updateAgent, deleteAgent e handleToolCall mantêm-se iguais ao anterior, omitidos para brevidade se já tiver)
  // ... (incluir handleToolCall aqui igual ao passo anterior)
  private async handleToolCall(name: string, args: any, context: ChatContext, services: any[]): Promise<ToolExecutionResult> {
    try {
        switch (name) {
            case 'listMyAppointments': {
                const apps = await this.appointmentService.listUpcoming(context.tenantId, context.customerId)
                return { status: 'success', message: apps.length ? JSON.stringify(apps) : 'Nenhum agendamento.' }
            }
            case 'cancelAppointment': {
                await this.appointmentService.cancelAppointment(context.tenantId, context.customerId, args.appointmentId)
                return { status: 'success', message: 'Cancelado.' }
            }
            case 'rescheduleAppointment': {
                const updated = await this.appointmentService.rescheduleAppointment(
                    context.tenantId, args.appointmentId, new Date(args.newDateTime), context.customerId
                )
                return { status: 'success', message: `Reagendado para ${updated.startTime}.` }
            }
            case 'createAppointment': {
                const inputName = normalizeString(args.serviceName);
                const service = services.find(s => normalizeString(s.name).includes(inputName));
                
                const app = await this.appointmentService.createAppointment({
                    tenantId: context.tenantId,
                    customerId: context.customerId,
                    serviceId: service?.id,
                    title: service?.name || args.serviceName,
                    startTime: new Date(args.dateTime),
                    clientName: args.clientName || context.customerName,
                    clientPhone: args.clientPhone || context.customerPhone
                })
                return { status: 'success', message: `Agendado: ${app.title} em ${app.startTime}` }
            }
            default: return { status: 'error', message: 'Ferramenta desconhecida.' }
        }
    } catch (error: any) {
        return { status: 'error', message: error.message || 'Erro ao processar.' }
    }
  }
}