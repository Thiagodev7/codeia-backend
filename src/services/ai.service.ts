import { GoogleGenerativeAI, Tool, Content, SchemaType } from '@google/generative-ai'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AppointmentService } from './appointment.service'

// Helper para normalização de strings (Busca Fuzzy)
function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const toolsDef: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "createAppointment",
        description: "Agendar um NOVO compromisso na agenda.",
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
        description: "Listar os agendamentos futuros do cliente.",
        parameters: { type: SchemaType.OBJECT, properties: {} }
      },
      {
        name: "cancelAppointment",
        description: "Cancelar um agendamento existente.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { appointmentId: { type: SchemaType.STRING, description: "ID do agendamento." } },
            required: ["appointmentId"]
        }
      },
      {
        name: "rescheduleAppointment",
        description: "Alterar a data/hora de um agendamento.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: { 
                appointmentId: { type: SchemaType.STRING },
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
  
  // Modelo Flash para baixa latência
  private readonly MODEL_NAME = "gemini-2.0-flash-lite"; 

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('❌ GEMINI_API_KEY ausente no ambiente (.env)')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  // --- CRUD AGENTES ---
  async createAgent(tenantId: string, data: any) {
    const existing = await prisma.agent.findUnique({ where: { tenantId_slug: { tenantId, slug: data.slug } } })
    if (existing) throw new Error(`Slug "${data.slug}" já existe.`)
    const activeCount = await prisma.agent.count({ where: { tenantId, isActive: true }})
    return prisma.agent.create({ data: { tenantId, ...data, model: this.MODEL_NAME, isActive: activeCount === 0 } })
  }
  async updateAgent(tenantId: string, agentId: string, data: any) {
     return prisma.agent.update({ where: { id: agentId }, data })
  }
  async deleteAgent(tenantId: string, agentId: string) {
    return prisma.agent.delete({ where: { id: agentId } })
  }

  // --- CHAT ENGINE ---
  async chat(
    agentId: string, 
    userMessage: string, 
    context: { tenantId: string, customerId: string, customerPhone: string, customerName: string },
    history: Content[] = []
  ) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    
    if (!agent || !agent.isActive) return { response: null }

    // 1. Busca Catálogo Completo (Nome, Duração, Preço, Descrição)
    const services = await prisma.service.findMany({
      where: { tenantId: context.tenantId, isActive: true },
      select: { 
        id: true, 
        name: true, 
        duration: true, 
        price: true,
        description: true // <--- CAMPO IMPORTANTE ADICIONADO
      }
    })
    
    // 2. Formatação Rica para o Prompt (Base de Conhecimento)
    const servicesKnowledgeBase = services.length > 0 
        ? services.map(s => {
            const price = Number(s.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const desc = s.description ? s.description : "Sem descrição detalhada.";
            return `🔹 **${s.name}**\n   - Preço: ${price}\n   - Duração: ${s.duration} min\n   - Detalhes: ${desc}`
        }).join('\n\n')
        : "Nenhum serviço cadastrado no sistema (aceite pedidos personalizados).";

    // 3. System Prompt Vendedor Sênior
    const systemPrompt = `
      ${agent.instructions}

      === 👤 DADOS DO CLIENTE ===
      - Nome: ${context.customerName}
      - Telefone: ${context.customerPhone} (Já identificado, não pergunte).

      === 💰 TABELA DE PREÇOS E DETALHES (FONTE DA VERDADE ABSOLUTA) ===
      Abaixo estão os ÚNICOS serviços, preços e detalhes que você conhece oficialmente.
      ${servicesKnowledgeBase}

      === 🚫 PROTOCOLO DE SEGURANÇA (ANTI-ALUCINAÇÃO) ===
      1. **Se não está na lista acima, VOCÊ NÃO SABE.** Não invente preços, não invente durações e não invente detalhes técnicos.
      2. Se o cliente perguntar o preço de algo que não está na lista, responda: "Como esse é um serviço personalizado, o valor é sob consulta com nossos especialistas no local. Mas posso agendar uma avaliação para você!"
      3. Nunca assuma que um serviço inclui algo (ex: lavagem, escova) se não estiver escrito na descrição acima.

      === 🧠 DIRETRIZES DE VENDAS ===
      1. **Consultoria:** Use a tabela acima para responder dúvidas com precisão.
      2. **Agendamento:** Convide para agendar usando 'createAppointment'.
      3. **Gestão:** Para cancelar/remarcar, sempre use 'listMyAppointments' primeiro.

      === 📅 DATA E HORA ===
      - Hoje: ${new Date().toLocaleDateString('pt-BR')}
      - Hora: ${new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}
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
                        toolResult = { status: 'success', message: 'Não encontrei nenhum agendamento futuro para você.' }
                    } else {
                        const listText = appointments.map(a => 
                            `🆔 ID: ${a.id} | ✂️ Serviço: ${a.title} | 🕒 Data: ${a.startTime.toLocaleString('pt-BR')}`
                        ).join('\n')
                        toolResult = { status: 'success', message: `Agendamentos encontrados:\n${listText}` }
                    }
                }
                
                // 2. CANCELAR
                else if (call.name === 'cancelAppointment') {
                    await this.appointmentService.cancelAppointment(context.tenantId, context.customerId, args.appointmentId)
                    toolResult = { status: 'success', message: 'Agendamento cancelado com sucesso.' }
                }
                
                // 3. REMARCAR
                else if (call.name === 'rescheduleAppointment') {
                    const updated = await this.appointmentService.rescheduleAppointment(
                        context.tenantId, 
                        context.customerId, 
                        args.appointmentId, 
                        new Date(args.newDateTime)
                    )
                    toolResult = { status: 'success', message: `Reagendado para ${updated.startTime.toLocaleString('pt-BR')}.` }
                }
                
                // 4. CRIAR
                else if (call.name === 'createAppointment') {
                    const inputName = normalizeString(args.serviceName);
                    let serviceMatch = services.find(s => normalizeString(s.name).includes(inputName) || inputName.includes(normalizeString(s.name)))
                    
                    if (!serviceMatch) {
                        serviceMatch = services.find(s => {
                            const dbWords = normalizeString(s.name).split(' ');
                            const inputWords = inputName.split(' ');
                            return inputWords.some(w => w.length > 3 && dbWords.includes(w));
                        })
                    }

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
                    
                    toolResult = { status: 'success', message: `Agendado: ${appointment.title} para ${appointment.startTime.toLocaleString('pt-BR')}` }
                }

            } catch (error: any) {
                let userMsg = 'Tive um problema técnico.'
                if (error.message.includes('CONFLICT')) userMsg = 'Esse horário já está ocupado. Tente outro.'
                if (error.message.includes('VALIDATION')) userMsg = 'Data inválida (passado).'
                if (error.message.includes('NOT_FOUND')) userMsg = 'Agendamento não encontrado.'
                
                logger.warn({ tool: call.name, error: error.message }, '⚠️ Erro Lógico na Tool')
                toolResult = { status: 'error', message: userMsg }
            }

            const nextPart = await chatSession.sendMessage([{
                functionResponse: { name: call.name, response: toolResult }
            }])
            
            return { response: nextPart.response.text(), action: call.name }
        }
      }
      
      return { response: response.text() }

    } catch (error: any) {
      logger.error({ error: error.message }, '❌ Erro IA')
      throw new Error("Erro na IA: " + error.message) 
    }
  }
}