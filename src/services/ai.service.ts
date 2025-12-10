import { GoogleGenerativeAI } from '@google/generative-ai'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export class AIService {
  private genAI: GoogleGenerativeAI

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY faltando no .env')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  async createAgent(tenantId: string, data: { name: string; slug: string; instructions: string }) {
    return prisma.agent.create({
      data: { tenantId, ...data }
    })
  }

  async chat(agentId: string, userMessage: string) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent) throw new Error('Agente não encontrado')

    // Instancia o modelo com a "Personalidade" do Agente
    const model = this.genAI.getGenerativeModel({ 
      model: agent.model,
      systemInstruction: agent.instructions 
    })

    try {
      const result = await model.generateContent(userMessage)
      return { response: result.response.text() }
    } catch (error) {
      logger.error(error, 'Erro na IA')
      return { response: "Desculpe, tive um problema para processar sua mensagem." }
    }
  }
}