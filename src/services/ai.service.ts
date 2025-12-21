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

/**
 * Normaliza uma string para busca aproximada (remove acentos, caixa baixa, trim).
 */
function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Definição das ferramentas (Tools) disponíveis para o modelo Gemini.
 * Este esquema permite que a IA solicite ações estruturadas ao backend.
 */
const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "createAppointment",
        description: "Agendar um NOVO compromisso. Use quando o usuário quiser explicitamente marcar algo.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            serviceName: { type: SchemaType.STRING, description: "Nome do serviço desejado (ex: 'Corte de Cabelo')." },
            dateTime: { type: SchemaType.STRING, description: "Data e Hora no formato ISO 8601 (ex: 2024-12-12T14:30:00)." },
            clientName: { type: SchemaType.STRING, description: "Nome do cliente (opcional, inferir do contexto)." },
            clientPhone: { type: SchemaType.STRING, description: "Telefone do cliente (opcional, inferir do contexto)." }
          },
          required: ["serviceName", "dateTime"]
        }
      },
      {
        name: "listMyAppointments",
        description: "Listar os agendamentos futuros do cliente atual.",
        parameters: { type: SchemaType.OBJECT, properties: {} }
      },
      {
        name: "cancelAppointment",
        description: "Cancelar um agendamento existente pelo ID.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { appointmentId: { type: SchemaType.STRING, description: "O ID (UUID) do agendamento." } },
            required: ["appointmentId"]
        }
      },
      {
        name: "rescheduleAppointment",
        description: "Alterar a data/hora de um agendamento existente.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { 
                appointmentId: { type: SchemaType.STRING },
                newDateTime: { type: SchemaType.STRING, description: "Nova Data/Hora ISO 8601." }
            },
            required: ["appointmentId", "newDateTime"]
        }
      }
    ]
  }
]

/**
 * Service responsável pela lógica de Chat e Orquestração de Agentes IA.
 * Integra-se com o Google Gemini e o AppointmentService local.
 */
export class AIService {
  private genAI: GoogleGenerativeAI
  private appointmentService = new AppointmentService()
  
  // Usando Flash-Lite para baixa latência e custo-benefício
  private readonly MODEL_NAME = "gemini-2.0-flash-lite"; 

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('❌ GEMINI_API_KEY ausente nas variáveis de ambiente (.env)')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  // --- CRUD AGENTES ---

  async createAgent(tenantId: string, data: { name: string, slug: string, instructions: string }) {
    const existing = await prisma.agent.findUnique({ where: { tenantId_slug: { tenantId, slug: data.slug } } })
    if (existing) throw Errors.Conflict(`Já existe um agente com o slug "${data.slug}".`)
    
    // O primeiro agente criado se torna ativo por padrão
    const activeCount = await prisma.agent.count({ where: { tenantId, isActive: true }})
    return prisma.agent.create({ 
      data: { tenantId, ...data, model: this.MODEL_NAME, isActive: activeCount === 0 } 
    })
  }

  async updateAgent(tenantId: string, agentId: string, data: any) {
     const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId } })
     if (!agent) throw Errors.NotFound('Agente não encontrado.')
     return prisma.agent.update({ where: { id: agentId }, data })
  }

  async deleteAgent(tenantId: string, agentId: string) {
    const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    if (!agent) throw Errors.NotFound('Agente não encontrado.')
    return prisma.agent.delete({ where: { id: agentId } })
  }

  // --- ENGINE DE CHAT ---

  /**
   * Ponto de entrada principal para o Chat com IA.
   * Gerencia contexto, construção de prompt, interação com o modelo e execução de ferramentas.
   */
  async chat(
    agentId: string, 
    userMessage: string, 
    context: ChatContext,
    history: Content[] = []
  ): Promise<ChatResult> {
    
    // 1. Validar Agente
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || !agent.isActive) {
        logger.warn({ agentId, tenantId: context.tenantId }, '⚠️ Tentativa de chat com agente inativo ou inexistente.')
        return { response: null }
    }

    // 2. Buscar Base de Conhecimento (Serviços)
    const services = await prisma.service.findMany({
      where: { tenantId: context.tenantId, isActive: true },
      select: { id: true, name: true, duration: true, price: true, description: true }
    })

    // 3. Construir System Prompt
    const systemPrompt = this.buildSystemPrompt(agent.instructions, context, services);

    // 4. Inicializar Modelo
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
      
      // 5. Lidar com Chamada de Ferramentas (se houver)
      if (functionCalls && functionCalls.length > 0) {
        // Nota: Atualmente lidamos apenas com a primeira chamada de função.
        // O Gemini suporta encadeamento, mas para este MVP focamos em uma ação por vez.
        const call = functionCalls[0]
        const toolResult = await this.handleToolCall(call.name, call.args, context, services)
        
        // Envia o resultado da ferramenta de volta para o Gemini gerar a resposta final em linguagem natural
        const nextPart = await chatSession.sendMessage([{
            functionResponse: { name: call.name, response: toolResult }
        }])
        
        return { response: nextPart.response.text(), action: call.name }
      }
      
      // Nenhuma ferramenta chamada, apenas retorna o texto
      return { response: response.text() }

    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, '❌ [AI Service] Falha Crítica')
      throw Errors.Internal("Erro no Serviço de IA: " + error.message)
    }
  }

  // --- MÉTODOS PRIVADOS AUXILIARES ---

  /**
   * Constrói o System Prompt com injeção dinâmica de contexto.
   */
  private buildSystemPrompt(instructions: string, context: ChatContext, services: any[]): string {
    const servicesKnowledgeBase = services.length > 0 
        ? services.map(s => {
            const price = Number(s.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const desc = s.description ? s.description : "Sem descrição.";
            return `🔹 **${s.name}**\n   - Preço: ${price}\n   - Duração: ${s.duration} min\n   - Detalhes: ${desc}`
        }).join('\n\n')
        : "Nenhum serviço cadastrado. Aceite pedidos personalizados se a política permitir.";

    return `
      ${instructions}

      === 👤 CONTEXTO DO CLIENTE ===
      - Nome: ${context.customerName}
      - Telefone: ${context.customerPhone} (Já identificado).

      === 💰 CATÁLOGO DE SERVIÇOS (FONTE DA VERDADE) ===
      Abaixo estão os ÚNICOS serviços oficiais:
      ${servicesKnowledgeBase}

      === 🚫 PROTOCOLOS DE SEGURANÇA (ANTI-ALUCINAÇÃO) ===
      1. **Aderência Estrita:** Apenas cite preços e durações listados acima. Não adivinhe.
      2. **Serviços Desconhecidos:** Se o usuário pedir algo não listado, diga que é personalizado e requer avaliação.
      3. **Ferramentas:** Use 'createAppointment' para agendar. Use 'listMyAppointments' para gerenciar.

      === 📅 DATA E HORA ATUAL ===
      - Hoje: ${new Date().toLocaleDateString('pt-BR')}
      - Hora: ${new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}
    `
  }

  /**
   * Executa a lógica para uma chamada de ferramenta específica solicitada pela IA.
   */
  private async handleToolCall(name: string, args: any, context: ChatContext, services: any[]): Promise<ToolExecutionResult> {
    logger.info({ tool: name, args, tenantId: context.tenantId }, '🔧 [IA] Executando Ferramenta...')

    try {
        switch (name) {
            case 'listMyAppointments': {
                const appointments = await this.appointmentService.listUpcoming(context.tenantId, context.customerId)
                if (appointments.length === 0) {
                    return { status: 'success', message: 'Nenhum agendamento futuro encontrado.' }
                }
                const listText = appointments.map(a => 
                    `🆔 ID: ${a.id} | ✂️ Serviço: ${a.title} | 🕒 Data: ${a.startTime.toLocaleString('pt-BR')}`
                ).join('\n')
                return { status: 'success', message: `Agendamentos encontrados:\n${listText}` }
            }

            case 'cancelAppointment': {
                await this.appointmentService.cancelAppointment(context.tenantId, context.customerId, args.appointmentId)
                return { status: 'success', message: 'Agendamento cancelado com sucesso.' }
            }

            case 'rescheduleAppointment': {
              const updated = await this.appointmentService.rescheduleAppointment(
                  context.tenantId, 
                  args.appointmentId, // 2º: ID do Agendamento
                  new Date(args.newDateTime), // 3º: Nova Data (Date)
                  context.customerId // 4º: ID do Cliente (Opcional, mas a IA envia para segurança)
              )
              return { status: 'success', message: `Reagendado para ${updated.startTime.toLocaleString('pt-BR')}.` }
          }

            case 'createAppointment': {
                // Busca Fuzzy para encontrar o ID correto do serviço
                const inputName = normalizeString(args.serviceName);
                let serviceMatch = services.find(s => normalizeString(s.name).includes(inputName) || inputName.includes(normalizeString(s.name)))
                
                // Fallback: Estratégia de interseção de palavras
                if (!serviceMatch) {
                    serviceMatch = services.find(s => {
                        const dbWords = normalizeString(s.name).split(' ');
                        const inputWords = inputName.split(' ');
                        return inputWords.some(w => w.length > 3 && dbWords.includes(w));
                    })
                }

                const appointment = await this.appointmentService.createAppointment({
                    tenantId: context.tenantId,
                    customerId: context.customerId,
                    serviceId: serviceMatch?.id,
                    title: serviceMatch?.name || args.serviceName,
                    clientName: args.clientName || context.customerName,
                    clientPhone: args.clientPhone || context.customerPhone,
                    startTime: new Date(args.dateTime)
                })
                
                return { status: 'success', message: `Agendado: ${appointment.title} para ${appointment.startTime.toLocaleString('pt-BR')}` }
            }

            default:
                return { status: 'error', message: `Ferramenta ${name} não implementada.` }
        }

    } catch (error: any) {
        // Mapeia erros de lógica de negócio para mensagens amigáveis para a IA repassar
        let userMsg = 'Ocorreu um problema técnico.'
        if (error.message.includes('CONFLICT')) userMsg = 'Esse horário já está ocupado. Por favor, escolha outro.'
        if (error.message.includes('VALIDATION')) userMsg = 'Data inválida (passado ou formato incorreto).'
        if (error.message.includes('NOT_FOUND')) userMsg = 'Agendamento não encontrado ou não pertence a você.'
        
        logger.warn({ tool: name, error: error.message }, '⚠️ Erro Lógico na Execução da Tool')
        return { status: 'error', message: userMsg }
    }
  }
}