import { GoogleGenerativeAI, Tool, Content, SchemaType } from '@google/generative-ai'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AppointmentService } from './appointment.service'

// Função auxiliar para normalizar strings (remove acentos, caixa baixa, trim)
function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Definição da Ferramenta (Tool) para o Gemini
const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "createAppointment",
        description: "Agendar um compromisso. Extraia o máximo de informações possível do contexto.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            serviceName: { type: SchemaType.STRING, description: "Nome do serviço solicitado pelo cliente." },
            dateTime: { type: SchemaType.STRING, description: "Data e hora no formato ISO 8601 (Ex: 2024-12-12T14:30:00)." },
            clientName: { type: SchemaType.STRING, description: "Nome do cliente, se informado." },
            clientPhone: { type: SchemaType.STRING, description: "Telefone de contato, se informado." }
          },
          required: ["serviceName", "dateTime"]
        }
      }
    ]
  }
]

export class AIService {
  private genAI: GoogleGenerativeAI
  private appointmentService = new AppointmentService()
  
  // Modelo solicitado
  private readonly MODEL_NAME = "gemini-2.5-flash"; 

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY ausente')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  // --- MÉTODOS DE GERENCIAMENTO DE AGENTES (CRUD) ---

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
    logger.info(`💾 [DB] Agente ${updated.name} atualizado.`)
    return updated
  }

  async deleteAgent(tenantId: string, agentId: string) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || agent.tenantId !== tenantId) throw new Error('Agente não encontrado.')
    return prisma.agent.delete({ where: { id: agentId } })
  }

  // --- LÓGICA DO CHAT (CORE) ---

  async chat(
    agentId: string, 
    userMessage: string, 
    context: { tenantId: string, customerId: string },
    history: Content[] = []
  ) {
    // 1. Valida Agente
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent) throw new Error('Agente não encontrado')
    if (agent.isActive === false) return { response: null }

    // 2. Busca Serviços Disponíveis para Contexto
    const services = await prisma.service.findMany({
      where: { tenantId: context.tenantId, isActive: true },
      select: { id: true, name: true, duration: true, price: true }
    })
    
    const servicesListText = services.length > 0 
        ? services.map(s => `- "${s.name}" (${s.duration} min)`).join('\n')
        : "Nenhum serviço cadastrado (mas você pode agendar serviços personalizados).";

    // 3. Monta o Prompt de Sistema
    const systemPrompt = `
      ${agent.instructions}

      === DIRETRIZES DE AGENDAMENTO ===
      1. Tente associar o pedido do cliente a um dos "SERVIÇOS REAIS" listados abaixo.
      2. Se o cliente pedir algo diferente (ex: "Tecnologia", "Reunião"), VOCÊ TEM PERMISSÃO PARA AGENDAR. Use o nome exato que o cliente forneceu.
      3. Sempre confirme a data e hora antes de chamar a função de agendamento.
      4. Se possível, tente obter o nome e telefone do cliente, mas não seja intrusivo demais.

      === CONTEXTO TÉCNICO ===
      - Data Atual: ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      - Hora Atual: ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      
      === SERVIÇOS REAIS (PREFERÊNCIA) ===
      ${servicesListText}
    `

    // 4. Inicializa o Modelo
    const model = this.genAI.getGenerativeModel({ 
      model: this.MODEL_NAME,
      systemInstruction: systemPrompt,
      tools: toolsDef
    })

    const chatSession = model.startChat({ history })

    try {
      // 5. Envia Mensagem e Processa Ferramentas
      const result = await chatSession.sendMessage(userMessage)
      const response = result.response
      const functionCalls = response.functionCalls()
      
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0]
        
        if (call.name === 'createAppointment') {
          const args = call.args as any
          logger.info({ args }, '🤖 [IA] Solicitando agendamento...')

          try {
            // --- LÓGICA DE MATCHING INTELIGENTE ---
            const inputName = normalizeString(args.serviceName);
            
            // Tentativa 1: Busca parcial (includes)
            let serviceMatch = services.find(s => 
              normalizeString(s.name).includes(inputName) || 
              inputName.includes(normalizeString(s.name))
            )

            // Tentativa 2: Busca por palavras-chave (Fallback)
            if (!serviceMatch) {
                serviceMatch = services.find(s => {
                    const dbWords = normalizeString(s.name).split(' ');
                    const inputWords = inputName.split(' ');
                    return inputWords.some(w => w.length > 3 && dbWords.includes(w));
                })
            }

            // Definição do ID e Título a serem usados
            let serviceIdToUse = undefined; // undefined = AppointmentService usa padrão
            let titleToUse = args.serviceName; // Padrão = O que o usuário pediu

            if (serviceMatch) {
                serviceIdToUse = serviceMatch.id;
                titleToUse = serviceMatch.name; // Usa o nome oficial do banco
                logger.info(`🎯 Match de serviço encontrado: ${serviceMatch.name}`);
            } else {
                logger.warn(`⚠️ Serviço "${args.serviceName}" não existe no banco. Criando agendamento customizado.`);
            }
            
            // --- CHAMADA AO SERVICE ROBUSTO ---
            const appointment = await this.appointmentService.createAppointment({
              tenantId: context.tenantId,
              customerId: context.customerId,
              serviceId: serviceIdToUse, // Se undefined, o service trata como customizado
              title: titleToUse,
              clientName: args.clientName,
              clientPhone: args.clientPhone,
              startTime: new Date(args.dateTime)
            })

            // Retorno de Sucesso para a IA
            const funcRes = await chatSession.sendMessage([{
              functionResponse: {
                name: 'createAppointment',
                response: { 
                  status: 'success', 
                  message: `Agendamento confirmado com sucesso!\nServiço: ${appointment.title}\nHorário: ${appointment.startTime.toLocaleString('pt-BR')}` 
                }
              }
            }])
            
            return { response: funcRes.response.text(), action: 'appointment_created' }

          } catch (error: any) {
            // --- TRATAMENTO DE ERROS AMIGÁVEL ---
            let userMessage = 'Tive um problema técnico ao acessar a agenda.'

            if (error.message.includes('CONFLICT_ERROR')) {
                userMessage = 'Verifiquei aqui e esse horário já está ocupado. Poderia escolher outro horário?'
            } else if (error.message.includes('VALIDATION_ERROR')) {
                userMessage = 'Não consigo agendar datas no passado. Por favor, escolha uma data futura.'
            }

            logger.warn({ error: error.message }, '⚠️ Erro controlado no agendamento')

            // Retorna o erro para a IA explicar ao usuário
            const errRes = await chatSession.sendMessage([{
                functionResponse: { 
                    name: 'createAppointment', 
                    response: { status: 'error', message: userMessage } 
                }
            }])
            return { response: errRes.response.text() }
          }
        }
      }
      
      // Se não houve chamada de função, retorna texto normal
      return { response: response.text() }

    } catch (error: any) {
      logger.error({ error: error.message }, '❌ [Gemini] Erro Crítico na API')
      return { response: "Tive um problema momentâneo de conexão. Poderia repetir sua mensagem?" }
    }
  }
}