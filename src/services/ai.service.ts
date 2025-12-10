import { GoogleGenerativeAI, Tool, Content } from '@google/generative-ai'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

// Ferramentas
const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "createAppointment",
        description: "Agendar um compromisso no calendário.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Título do agendamento." },
            dateTime: { type: "STRING", description: "Data/hora ISO 8601 (Ex: 2025-12-12T14:30:00)." },
            description: { type: "STRING", description: "Detalhes opcionais." }
          },
          required: ["title", "dateTime"]
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

  // Criar Agente
  async createAgent(tenantId: string, data: { name: string; slug: string; instructions: string }) {
    const existing = await prisma.agent.findUnique({
      where: { tenantId_slug: { tenantId, slug: data.slug } }
    })
    if (existing) throw new Error(`O slug "${data.slug}" já existe.`)

    return prisma.agent.create({
      data: { 
        tenantId, 
        ...data,
        model: "gemini-2.5-flash"
      }
    })
  }

  // Atualizar
  async updateAgent(tenantId: string, agentId: string, data: { name?: string; slug?: string; instructions?: string; isActive?: boolean }) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || agent.tenantId !== tenantId) throw new Error('Agente não encontrado.')

    if (data.slug && data.slug !== agent.slug) {
      const slugExists = await prisma.agent.findUnique({
        where: { tenantId_slug: { tenantId, slug: data.slug } }
      })
      if (slugExists) throw new Error(`O slug "${data.slug}" já está em uso.`)
    }

    return prisma.agent.update({ where: { id: agentId }, data })
  }

  // Deletar
  async deleteAgent(tenantId: string, agentId: string) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || agent.tenantId !== tenantId) throw new Error('Agente não encontrado.')
    return prisma.agent.delete({ where: { id: agentId } })
  }

  // --- CHAT COM MEMÓRIA ---
  async chat(
    agentId: string, 
    userMessage: string, 
    context: { tenantId: string, customerId: string },
    history: Content[] = [] // <--- RECEBE O HISTÓRICO AQUI
  ) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent) throw new Error('Agente não encontrado')

    if (!agent.isActive) return { response: null }

    let modelName = agent.model;
    if (!modelName || modelName.includes('1.5')) modelName = 'gemini-2.5-flash';

    const model = this.genAI.getGenerativeModel({ 
      model: modelName,
      systemInstruction: `
        ${agent.instructions}
        CONTEXTO: Hoje é ${new Date().toLocaleString('pt-BR')}.
      `,
      tools: toolsDef
    })

    // INICIA O CHAT COM O HISTÓRICO DO BANCO
    const chatSession = model.startChat({
        history: history
    })

    try {
      const result = await chatSession.sendMessage(userMessage)
      const response = result.response
      const functionCalls = response.functionCalls()
      
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0]
        if (call.name === 'createAppointment') {
          const args = call.args as any
          try {
            const appointment = await prisma.appointment.create({
              data: {
                tenantId: context.tenantId,
                customerId: context.customerId,
                title: args.title,
                startTime: new Date(args.dateTime),
                endTime: new Date(new Date(args.dateTime).getTime() + 3600000),
                description: args.description || 'Via Bot',
                status: 'SCHEDULED'
              }
            })
            const funcRes = await chatSession.sendMessage([{
              functionResponse: {
                name: 'createAppointment',
                response: { status: 'success', id: appointment.id, message: `Agendado para ${args.dateTime}` }
              }
            }])
            return { response: funcRes.response.text(), action: 'appointment_created' }
          } catch (dbError) {
            return { response: "Erro ao acessar agenda." }
          }
        }
      }
      return { response: response.text() }

    } catch (error: any) {
      logger.error({ model: modelName, error: error.message }, 'Erro Gemini')
      
      if (error.message.includes('404')) {
          return { response: "Erro de configuração da conta Google AI." }
      }
      return { response: "Desculpe, tive um problema técnico." }
    }
  }
}