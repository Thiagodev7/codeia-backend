import { GoogleGenerativeAI, Tool, Content, SchemaType } from '@google/generative-ai'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AppointmentService } from './appointment.service'
import { Errors } from '../lib/errors'

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
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Converte o JSON de horários do banco para texto legível.
 */
function formatBusinessHours(schedule: any): string {
  if (!schedule) return "Horário não configurado (Consulte o suporte).";

  const dayMap: Record<string, string> = {
    mon: "Segunda-feira",
    tue: "Terça-feira",
    wed: "Quarta-feira",
    thu: "Quinta-feira",
    fri: "Sexta-feira",
    sat: "Sábado",
    sun: "Domingo"
  };

  const orderedKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  const lines = orderedKeys.map(key => {
    const dayConfig = schedule[key];
    const dayName = dayMap[key] || key;

    if (!dayConfig || dayConfig.open === false) {
      return `- ${dayName}: Fechado 🚫`;
    }

    return `- ${dayName}: ${dayConfig.start} às ${dayConfig.end} ✅`;
  });

  return lines.join('\n      ');
}

// Definição das ferramentas
const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "createAppointment",
        description: "Agendar um NOVO compromisso.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            serviceName: { type: SchemaType.STRING, description: "Nome do serviço." },
            dateTime: { type: SchemaType.STRING, description: "Data e Hora ISO 8601 COM FUSO (ex: 2024-12-01T14:00:00-03:00)." },
            clientName: { type: SchemaType.STRING, description: "Nome do cliente." },
            clientPhone: { type: SchemaType.STRING, description: "Telefone do cliente." }
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
            properties: { 
                appointmentId: { type: SchemaType.STRING },
                newDateTime: { type: SchemaType.STRING }
            },
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

  // --- ENGINE DE CHAT ---

  async chat(
    agentId: string, 
    userMessage: string, 
    context: ChatContext,
    history: Content[] = []
  ): Promise<ChatResult> {
    
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || !agent.isActive) return { response: null }

    // 1. Configurações (Fuso Horário)
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: context.tenantId } })

    // 2. Serviços
    const services = await prisma.service.findMany({
      where: { tenantId: context.tenantId, isActive: true },
      select: { id: true, name: true, duration: true, price: true, description: true }
    })

    // 3. Prompt (Com injeção de Timezone correta)
    const systemPrompt = this.buildSystemPrompt(agent.instructions, context, services, settings, (settings as any)?.businessHours);

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
        
        const nextPart = await chatSession.sendMessage([{
            functionResponse: { name: call.name, response: toolResult }
        }])
        
        return { response: nextPart.response.text(), action: call.name }
      }
      
      return { response: response.text() }

    } catch (error: any) {
      logger.error({ error: error.message }, '❌ Falha no Chat IA')
      throw Errors.Internal("Erro no Serviço de IA.")
    }
  }

  // --- MÉTODOS PRIVADOS ---

  private buildSystemPrompt(instructions: string, context: ChatContext, services: any[], settings: any, businessHours: any[]): string {
    const servicesList = services.map(s => 
        `🔹 ${s.name} (${s.duration}min) - R$ ${Number(s.price).toFixed(2)}`
    ).join('\n');

    // FORMATAÇÃO DE HORÁRIOS
    // Se o novo formato array vier do banco, converte para objeto ou usa direto.
    // Aqui assumimos que 'settings.businessHours' pode ser o array da tabela nova ou json antigo.
    // Para simplificar, vou usar o helper formatBusinessHours que fizemos antes.
    let hoursText = "Consulte disponibilidade.";
    if (Array.isArray(businessHours) && businessHours.length > 0) {
       // Se vier da tabela nova (Array)
       const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
       hoursText = businessHours.map(h => {
         const day = DAY_NAMES[h.dayOfWeek];
         return h.isOpen ? `- ${day}: ${h.startTime} às ${h.endTime} ✅` : `- ${day}: Fechado 🚫`;
       }).join('\n      ');
    } else {
       // Fallback para JSON antigo (se houver migração pendente)
       hoursText = formatBusinessHours(settings?.businessHours);
    }

    // --- CORREÇÃO DE DATA/FUSO ---
    const timeZone = settings?.timezone || 'America/Sao_Paulo';
    
    // Data formatada explicitamente no fuso da empresa
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });

    const companyInfo = settings ? `
      - Empresa: ${settings.businessName || 'Não informado'}
      - Endereço: ${settings.address || 'Não informado'}
      
      🕒 HORÁRIOS DE ATENDIMENTO:
      ${hoursText}
    ` : "Sem dados da empresa.";

    return `
      === 🤖 PERSONA ===
      ${instructions}

      === 🏢 EMPRESA (Fuso: ${timeZone}) ===
      ${companyInfo}

      === 👤 CLIENTE ===
      Nome: ${context.customerName}

      === 💰 SERVIÇOS ===
      ${servicesList || "Nenhum serviço cadastrado."}

      === 🚨 REGRAS DE DATA E HORA (CRÍTICO) ===
      1. **Hoje é:** ${dateStr}.
      2. **Hora atual:** ${timeStr}.
      3. Ao agendar, calcule a data futura corretamente.
      4. **IMPORTANTE:** Ao chamar a função 'createAppointment', envie a data no formato ISO 8601 COMPLETO COM OFFSET do fuso horário.
         - Exemplo Correto: 2026-05-02T14:00:00-03:00 (Isso garante que o servidor entenda que é horário do Brasil).
         - Exemplo Errado: 2026-05-02T14:00:00 (Isso será tratado como UTC e causará erro de "data passada").
    `
  }

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
                
                // Conversão segura de data
                const appointmentDate = new Date(args.dateTime);
                
                // Validação extra de segurança antes de chamar o service
                if (isNaN(appointmentDate.getTime())) {
                    return { status: 'error', message: 'Data inválida. Tente novamente.' };
                }

                const app = await this.appointmentService.createAppointment({
                    tenantId: context.tenantId,
                    customerId: context.customerId,
                    serviceId: service?.id,
                    title: service?.name || args.serviceName,
                    startTime: appointmentDate,
                    clientName: args.clientName || context.customerName,
                    clientPhone: args.clientPhone || context.customerPhone
                })
                return { status: 'success', message: `Agendado: ${app.title} em ${app.startTime.toLocaleString('pt-BR')}` }
            }
            default: return { status: 'error', message: 'Ferramenta desconhecida.' }
        }
    } catch (error: any) {
        // Tratamento amigável de erros conhecidos
        if (error.message.includes('passado')) {
            return { status: 'error', message: 'Erro de fuso horário: O sistema achou que esse horário já passou. Por favor, tente um horário um pouco mais tarde.' };
        }
        return { status: 'error', message: error.message || 'Erro ao processar.' }
    }
  }
  
  // (Métodos auxiliares CRUD de agentes mantidos iguais ao original)
  async createAgent(tenantId: string, data: any) {
    const existing = await prisma.agent.findUnique({ where: { tenantId_slug: { tenantId, slug: data.slug } } })
    if (existing) throw Errors.Conflict(`Slug "${data.slug}" já existe.`)
    const activeCount = await prisma.agent.count({ where: { tenantId, isActive: true }})
    return prisma.agent.create({ data: { tenantId, ...data, model: this.MODEL_NAME, isActive: activeCount === 0 } })
  }
  async updateAgent(tenantId: string, agentId: string, data: any) {
     return prisma.agent.update({ where: { id: agentId }, data })
  }
  async deleteAgent(tenantId: string, agentId: string) {
    return prisma.agent.delete({ where: { id: agentId } })
  }
}