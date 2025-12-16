import { GoogleGenerativeAI, Tool, Content } from '@google/generative-ai'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "createAppointment",
        description: "Agendar um compromisso no calendário. Verifique serviços e horários antes.",
        parameters: {
          type: "OBJECT",
          properties: {
            serviceName: { type: "STRING", description: "Nome do serviço desejado." },
            dateTime: { type: "STRING", description: "Data e hora ISO 8601 (Ex: 2025-12-12T14:30:00)." },
            clientName: { type: "STRING", description: "Nome do cliente." }
          },
          required: ["serviceName", "dateTime"]
        }
      }
    ]
  }
]

export class AIService {
  private genAI: GoogleGenerativeAI
  
  // Modelo de Produção (Billing Ativo)
  private readonly MODEL_NAME = "gemini-2.5-flash"; 

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY ausente')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  // --- CRUD AGENTES ---
  async createAgent(tenantId: string, data: any) {
    const existing = await prisma.agent.findUnique({
      where: { tenantId_slug: { tenantId, slug: data.slug } }
    })
    if (existing) throw new Error(`O slug "${data.slug}" já existe.`)

    const activeCount = await prisma.agent.count({ where: { tenantId, isActive: true }})
    const startActive = activeCount === 0;

    return prisma.agent.create({
      data: { 
        tenantId, 
        ...data,
        model: this.MODEL_NAME,
        isActive: startActive
      }
    })
  }

  async updateAgent(tenantId: string, agentId: string, data: any) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || agent.tenantId !== tenantId) throw new Error('Agente não encontrado.')

    if (data.slug && data.slug !== agent.slug) {
      const slugExists = await prisma.agent.findUnique({
        where: { tenantId_slug: { tenantId, slug: data.slug } }
      })
      if (slugExists) throw new Error(`O slug "${data.slug}" já está em uso.`)
    }

    if (data.isActive === true) {
        await prisma.agent.updateMany({
            where: { tenantId, id: { not: agentId } },
            data: { isActive: false }
        })
    }

    const updated = await prisma.agent.update({ where: { id: agentId }, data })
    logger.info(`💾 [DB] Agente ${updated.name} atualizado. Status: ${updated.isActive ? 'ATIVO' : 'PAUSADO'}`)
    return updated
  }

  async deleteAgent(tenantId: string, agentId: string) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || agent.tenantId !== tenantId) throw new Error('Agente não encontrado.')
    return prisma.agent.delete({ where: { id: agentId } })
  }

  // --- CHAT GENÉRICO (PERSONALIDADE VEM DO BANCO) ---
  async chat(
    agentId: string, 
    userMessage: string, 
    context: { tenantId: string, customerId: string },
    history: Content[] = []
  ) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent) throw new Error('Agente não encontrado')
    
    if (agent.isActive === false) return { response: null }

    // Busca serviços para injetar no contexto
    const services = await prisma.service.findMany({
      where: { tenantId: context.tenantId, isActive: true },
      select: { name: true, duration: true, price: true }
    })
    const servicesList = services.length > 0 
        ? services.map(s => `- ${s.name} (${s.duration} min) R$${Number(s.price).toFixed(2)}`).join('\n')
        : "Nenhum serviço cadastrado.";

    // --- PROMPT DINÂMICO ---
    // Aqui misturamos a configuração do usuário com dados técnicos obrigatórios
    const systemPrompt = `
      ${agent.instructions}

      === CONTEXTO TÉCNICO OBRIGATÓRIO (NÃO IGNORE) ===
      - Hoje é: ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
      - Hora atual: ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      
      === LISTA DE SERVIÇOS/PRODUTOS DISPONÍVEIS ===
      ${servicesList}

      === INSTRUÇÕES DE FERRAMENTAS ===
      - Se o cliente quiser agendar, VERIFIQUE na lista acima se o serviço existe.
      - Use a ferramenta 'createAppointment' para confirmar.
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
        const call = functionCalls[0]
        if (call.name === 'createAppointment') {
          const args = call.args as any
          
          try {
            const serviceMatch = services.find(s => s.name.toLowerCase().includes(args.serviceName.toLowerCase()))
            const duration = serviceMatch ? serviceMatch.duration : 60
            const serviceId = serviceMatch ? (await prisma.service.findFirst({where: {tenantId: context.tenantId, name: serviceMatch.name}}))?.id : null
            
            const startTime = new Date(args.dateTime)
            const endTime = new Date(startTime.getTime() + duration * 60000)

            const appointment = await prisma.appointment.create({
              data: {
                tenantId: context.tenantId,
                customerId: context.customerId,
                serviceId: serviceId,
                title: args.serviceName || 'Atendimento',
                startTime: startTime,
                endTime: endTime,
                description: `Agendado via Bot (${duration}min)`,
                status: 'SCHEDULED'
              }
            })

            const funcRes = await chatSession.sendMessage([{
              functionResponse: {
                name: 'createAppointment',
                response: { 
                  status: 'success', 
                  id: appointment.id, 
                  message: `Agendado para ${startTime.toLocaleString('pt-BR')}` 
                }
              }
            }])
            return { response: funcRes.response.text(), action: 'appointment_created' }

          } catch (dbError) {
            logger.error(dbError, 'Erro ao agendar')
            const errRes = await chatSession.sendMessage([{
                functionResponse: {
                    name: 'createAppointment',
                    response: { status: 'error', message: 'Erro ao salvar no banco de dados.' }
                }
            }])
            return { response: errRes.response.text() }
          }
        }
      }
      return { response: response.text() }

    } catch (error: any) {
      logger.error({ error: error.message }, 'Erro Gemini API')
      if (error.message.includes('404') || error.message.includes('not found')) {
          return { response: "Erro de configuração do modelo de IA (404). Contate o suporte." }
      }
      return { response: "Tive um problema técnico momentâneo. Pode repetir?" }
    }
  }
}