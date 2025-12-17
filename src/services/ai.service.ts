import { GoogleGenerativeAI, Tool, Content, SchemaType } from '@google/generative-ai'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AppointmentService } from './appointment.service'

// Helper para normalização de strings (Busca Fuzzy)
function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Definição das Ferramentas (Function Calling) - COM GATILHOS RESTRITIVOS
const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "createAppointment",
        description: "Use APENAS quando o usuário indicar claramente a intenção de CRIAR ou AGENDAR algo novo. Não use para remarcar.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            serviceName: { type: SchemaType.STRING, description: "Nome do serviço desejado." },
            dateTime: { type: SchemaType.STRING, description: "Data e Hora ISO 8601 (Ex: 2024-12-12T14:30:00)." },
            clientName: { type: SchemaType.STRING, description: "Nome do cliente (opcional, use contexto)." },
            clientPhone: { type: SchemaType.STRING, description: "Telefone do cliente (opcional, use contexto)." }
          },
          required: ["serviceName", "dateTime"]
        }
      },
      {
        name: "listMyAppointments",
        description: "Use quando o usuário perguntar 'o que tenho agendado', 'ver minha agenda', 'quais meus horários', OU quando ele quiser cancelar/remarcar mas não especificou qual agendamento.",
        parameters: { type: SchemaType.OBJECT, properties: {} }
      },
      {
        name: "cancelAppointment",
        description: "Use SOMENTE se o usuário confirmou explicitamente qual agendamento quer cancelar após visualizar a lista.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { appointmentId: { type: SchemaType.STRING, description: "ID exato do agendamento." } },
            required: ["appointmentId"]
        }
      },
      {
        name: "rescheduleAppointment",
        description: "Use SOMENTE se o usuário confirmou explicitamente qual agendamento quer mover E a nova data. NÃO use se o usuário apenas perguntou o que tem marcado.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { 
                appointmentId: { type: SchemaType.STRING, description: "ID exato do agendamento." },
                newDateTime: { type: SchemaType.STRING, description: "Nova Data ISO 8601." }
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
  
  // Modelo Flash (Rápido e Eficiente)
  private readonly MODEL_NAME = "gemini-2.5-flash"; 

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('❌ GEMINI_API_KEY ausente no ambiente (.env)')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  // --- MÉTODOS CRUD DE AGENTES (Mantidos) ---
  async createAgent(tenantId: string, data: any) {
    const existing = await prisma.agent.findUnique({ where: { tenantId_slug: { tenantId, slug: data.slug } } })
    if (existing) throw new Error(`O slug "${data.slug}" já está em uso.`)
    const activeCount = await prisma.agent.count({ where: { tenantId, isActive: true }})
    return prisma.agent.create({ data: { tenantId, ...data, model: this.MODEL_NAME, isActive: activeCount === 0 } })
  }
  async updateAgent(tenantId: string, agentId: string, data: any) {
     return prisma.agent.update({ where: { id: agentId }, data })
  }
  async deleteAgent(tenantId: string, agentId: string) {
    return prisma.agent.delete({ where: { id: agentId } })
  }

  // --- ENGINE DE CHAT (Core da IA) ---

  async chat(
    agentId: string, 
    userMessage: string, 
    context: { tenantId: string, customerId: string, customerPhone: string, customerName: string },
    history: Content[] = []
  ) {
    const start = Date.now()
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    
    if (!agent || !agent.isActive) return { response: null }

    // Contexto de Serviços
    const services = await prisma.service.findMany({
      where: { tenantId: context.tenantId, isActive: true },
      select: { id: true, name: true, duration: true, price: true }
    })
    
    const servicesListText = services.length > 0 
        ? services.map(s => `- "${s.name}" (${s.duration} min)`).join('\n')
        : "Nenhum serviço cadastrado (aceite nomes personalizados).";

    // --- SYSTEM PROMPT BLINDADO ---
    const systemPrompt = `
      ${agent.instructions}

      === 🔒 PROTOCOLOS DE SEGURANÇA ===
      1. **NAVEGAÇÃO**: Se o usuário perguntar "quais meus agendamentos?" ou "tenho algo marcado?", USE APENAS 'listMyAppointments'. NUNCA use 'rescheduleAppointment' ou 'cancelAppointment' nessa etapa, mesmo que o histórico tenha IDs antigos.
      2. **IDENTIFICAÇÃO**: Você só pode cancelar ou remarcar se tiver certeza do ID atual. Se tiver dúvida, chame 'listMyAppointments' novamente.
      3. **DADOS DO CLIENTE**: O telefone é ${context.customerPhone}. Use-o automaticamente nas ferramentas. Não pergunte.

      === 🧠 RACIOCÍNIO ESPERADO ===
      - Usuário: "Quero cortar cabelo" -> createAppointment
      - Usuário: "Quero remarcar" -> listMyAppointments (para ver o que existe)
      - Usuário: "Quero ver minha agenda" -> listMyAppointments
      - Usuário: "Remarca o corte de cabelo para amanhã" -> rescheduleAppointment (se souber o ID) OU listMyAppointments (se não souber)

      === 📅 DATA DE HOJE ===
      - ${new Date().toLocaleString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
      
      === 📋 SERVIÇOS ===
      ${servicesListText}
    `

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
        
        for (const call of functionCalls) {
            const args = call.args as any
            let toolResult: any = { status: 'error', message: 'Ação desconhecida' }
            
            logger.info({ tool: call.name, args }, '🔧 [IA] Executando ferramenta...')

            try {
                // 1. LISTAR
                if (call.name === 'listMyAppointments') {
                    const appointments = await this.appointmentService.listUpcoming(context.tenantId, context.customerId)
                    if (appointments.length === 0) {
                        toolResult = { status: 'success', message: 'Você não possui agendamentos futuros confirmados.' }
                    } else {
                        const listText = appointments.map(a => 
                            `🆔 ID: ${a.id} | Serviço: "${a.title}" | 📅 ${a.startTime.toLocaleString('pt-BR')}`
                        ).join('\n')
                        toolResult = { status: 'success', message: `Aqui estão seus agendamentos:\n${listText}\n\nPara alterar, diga "remarcar o ID..."` }
                    }
                }
                
                // 2. CANCELAR
                else if (call.name === 'cancelAppointment') {
                    if (!args.appointmentId) throw new Error('ID do agendamento ausente.')
                    await this.appointmentService.cancelAppointment(context.tenantId, context.customerId, args.appointmentId)
                    toolResult = { status: 'success', message: 'Agendamento cancelado com sucesso.' }
                }
                
                // 3. REMARCAR
                else if (call.name === 'rescheduleAppointment') {
                    if (!args.appointmentId) throw new Error('ID do agendamento ausente. Liste primeiro.')
                    
                    const updated = await this.appointmentService.rescheduleAppointment(
                        context.tenantId, 
                        context.customerId, 
                        args.appointmentId, 
                        new Date(args.newDateTime)
                    )
                    toolResult = { status: 'success', message: `Confirmado! Remarcado para ${updated.startTime.toLocaleString('pt-BR')}.` }
                }
                
                // 4. CRIAR
                else if (call.name === 'createAppointment') {
                    // Match Híbrido de Serviço
                    const inputName = normalizeString(args.serviceName);
                    let serviceMatch = services.find(s => normalizeString(s.name).includes(inputName) || inputName.includes(normalizeString(s.name)))
                    
                    if (!serviceMatch) {
                        // Fallback por palavra-chave
                        serviceMatch = services.find(s => {
                            const dbWords = normalizeString(s.name).split(' ');
                            const inputWords = inputName.split(' ');
                            return inputWords.some(w => w.length > 3 && dbWords.includes(w));
                        })
                    }

                    // Injeção de Contexto
                    const finalPhone = args.clientPhone || context.customerPhone;
                    const finalName = args.clientName || context.customerName;

                    const appointment = await this.appointmentService.createAppointment({
                        tenantId: context.tenantId,
                        customerId: context.customerId,
                        serviceId: serviceMatch?.id,
                        title: serviceMatch?.name || args.serviceName,
                        clientName: finalName,
                        clientPhone: finalPhone,
                        startTime: new Date(args.dateTime)
                    })
                    
                    toolResult = { status: 'success', message: `Agendado: "${appointment.title}" para ${appointment.startTime.toLocaleString('pt-BR')}` }
                }

            } catch (error: any) {
                // Tratamento de Erro para o Usuário
                let userMsg = 'Tive uma falha técnica.'
                
                if (error.message.includes('CONFLICT')) userMsg = '❌ O horário solicitado já está ocupado. Por favor, escolha outro.'
                if (error.message.includes('VALIDATION')) userMsg = '❌ Data inválida. Verifique se não é uma data passada.'
                if (error.message.includes('NOT_FOUND')) userMsg = '❌ Não encontrei esse agendamento. Vamos listar seus horários novamente?'
                if (error.message.includes('ALREADY_CANCELED')) userMsg = '⚠️ Este agendamento já estava cancelado.'
                
                logger.warn({ tool: call.name, error: error.message }, '⚠️ Erro de Negócio na Tool.')
                toolResult = { status: 'error', message: userMsg }
            }

            const nextPart = await chatSession.sendMessage([{
                functionResponse: { name: call.name, response: toolResult }
            }])
            
            return { response: nextPart.response.text(), action: call.name }
        }
      }
      
      logger.info({ duration: `${Date.now() - start}ms` }, '🧠 [IA] Resposta de texto gerada.')
      return { response: response.text() }

    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, '🔥 [IA] CRITICAL: Falha na comunicação com Gemini')
      throw new Error("Erro de processamento na IA: " + error.message) 
    }
  }
}