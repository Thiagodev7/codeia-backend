import { GoogleGenerativeAI, Tool } from '@google/generative-ai'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "createAppointment",
        description: "Agendar um serviço. Tente sempre usar o nome exato do serviço disponível.",
        parameters: {
          type: "OBJECT",
          properties: {
            serviceName: { type: "STRING", description: "Nome do serviço desejado (ex: Corte de Cabelo)." },
            dateTime: { type: "STRING", description: "Data e hora ISO 8601 (Ex: 2025-12-25T14:30:00)." },
            clientName: { type: "STRING", description: "Nome do cliente (se disponível)." }
          },
          required: ["serviceName", "dateTime"]
        }
      },
      {
        name: "checkAvailability",
        description: "Verificar se um horário está livre antes de agendar.",
        parameters: {
          type: "OBJECT",
          properties: {
            dateTime: { type: "STRING", description: "Data e hora desejada." }
          },
          required: ["dateTime"]
        }
      }
    ]
  }
]

export class AIService {
  private genAI: GoogleGenerativeAI

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY ausente')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  // ... (createAgent mantém igual)
  async createAgent(tenantId: string, data: any) {
    const existing = await prisma.agent.findUnique({ where: { tenantId_slug: { tenantId, slug: data.slug } } })
    if (existing) throw new Error(`Slug em uso.`)
    return prisma.agent.create({ data: { tenantId, ...data, model: "gemini-2.5-flash-lite" } })
  }

  // --- CHAT INTELIGENTE ---
  async chat(agentId: string, userMessage: string, context: { tenantId: string, customerId: string }, history: any[] = []) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent) throw new Error('Agente não encontrado')
    if (!agent.isActive) return { response: null }

    // 1. BUSCAR SERVIÇOS DO BANCO
    const services = await prisma.service.findMany({
      where: { tenantId: context.tenantId, isActive: true },
      select: { name: true, duration: true, price: true }
    })

    // Monta o "Menu" para a IA
    const servicesList = services.map(s => `- ${s.name} (${s.duration} min) - R$ ${s.price}`).join('\n')

    const systemPrompt = `
      ${agent.instructions}
      
      === CONTEXTO DO SISTEMA ===
      - Hoje é: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
      
      === SERVIÇOS DISPONÍVEIS (MENU) ===
      ${services.length > 0 ? servicesList : "Nenhum serviço cadastrado ainda. Apenas agende horários genéricos de 1h."}
      
      === REGRAS DE AGENDAMENTO ===
      1. Se o cliente pedir um serviço, verifique se existe no MENU acima.
      2. Use a duração correta do serviço para calcular o fim do agendamento.
      3. Antes de confirmar, VERIFIQUE se o horário está livre (mas pode tentar agendar direto que eu valido).
      4. Se der erro de "Horário Ocupado", avise o cliente e sugira outro.
    `

    const model = this.genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite",
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
        
        // --- FERRAMENTA: AGENDAR ---
        if (call.name === 'createAppointment') {
          const args = call.args as any
          
          // A. Descobrir a duração baseada no nome do serviço
          // A IA tenta mandar o nome, nós buscamos o match mais próximo ou exato
          const serviceMatch = services.find(s => s.name.toLowerCase().includes(args.serviceName.toLowerCase()))
          
          const duration = serviceMatch ? serviceMatch.duration : 60 // Padrão 1h se não achar
          const serviceId = serviceMatch ? (await prisma.service.findFirst({where: {tenantId: context.tenantId, name: serviceMatch.name}}))?.id : null

          const startTime = new Date(args.dateTime)
          const endTime = new Date(startTime.getTime() + duration * 60000)

          // B. VERIFICAÇÃO DE CONFLITO (CRÍTICO)
          const conflict = await prisma.appointment.findFirst({
            where: {
              tenantId: context.tenantId,
              status: 'SCHEDULED',
              OR: [
                { startTime: { lt: endTime }, endTime: { gt: startTime } } // Lógica de sobreposição de tempo
              ]
            }
          })

          if (conflict) {
            // Retorna erro para a IA tratar e avisar o usuário
            const funcRes = await chatSession.sendMessage([{
              functionResponse: {
                name: 'createAppointment',
                response: { status: 'error', message: 'ERRO: Horário já está ocupado por outro cliente.' }
              }
            }])
            return { response: funcRes.response.text(), action: 'conflict_detected' }
          }

          // C. Se livre, Agenda!
          try {
            const appointment = await prisma.appointment.create({
              data: {
                tenantId: context.tenantId,
                customerId: context.customerId,
                serviceId: serviceId,
                title: args.serviceName || 'Atendimento',
                startTime: startTime,
                endTime: endTime,
                description: `Agendado via Bot. Duração: ${duration}min`,
                status: 'SCHEDULED'
              }
            })

            const funcRes = await chatSession.sendMessage([{
              functionResponse: {
                name: 'createAppointment',
                response: { 
                  status: 'success', 
                  id: appointment.id, 
                  message: `Agendado com sucesso! ${args.serviceName} às ${startTime.toLocaleTimeString()} (${duration} min).` 
                }
              }
            }])
            return { response: funcRes.response.text(), action: 'appointment_created' }

          } catch (dbError) {
            return { response: "Erro técnico ao gravar na agenda." }
          }
        }
      }
      return { response: response.text() }

    } catch (error: any) {
      logger.error({ error: error.message }, 'Erro Gemini')
      return { response: "Desculpe, tive um problema técnico." }
    }
  }
}