import { z } from 'zod'

/**
 * DTOs (Data Transfer Objects) centralizados para validação de requests
 * Todos os schemas de validação de entrada devem ser definidos aqui
 */

// ==================== AUTH ====================

export const LoginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
})

export const RegisterSchema = z.object({
  tenantName: z.string().min(3, 'Nome da empresa deve ter no mínimo 3 caracteres'),
  document: z.string().regex(/^\d{11,14}$/, 'CPF/CNPJ inválido'),
  userName: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
  phone: z.string().optional(),
})

// ==================== AGENTS ====================

export const CreateAgentSchema = z.object({
  name: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
  instructions: z.string().min(10, 'Instruções devem ter no mínimo 10 caracteres'),
  model: z.string().optional().default('gemini-2.0-flash-lite'),
})

export const UpdateAgentSchema = CreateAgentSchema.partial()

// ==================== SERVICES ====================

export const CreateServiceSchema = z.object({
  name: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  description: z.string().optional(),
  price: z.number().min(0, 'Preço deve ser positivo').default(0),
  duration: z.number().int().min(15, 'Duração mínima de 15 minutos'),
})

export const UpdateServiceSchema = CreateServiceSchema.partial()

// ==================== APPOINTMENTS ====================

export const CreateAppointmentSchema = z.object({
  customerId: z.string().uuid('ID do cliente inválido'),
  serviceId: z.string().uuid('ID do serviço inválido').optional(),
  title: z.string().min(3, 'Título deve ter no mínimo 3 caracteres'),
  description: z.string().optional(),
  startTime: z.string().datetime('Data/hora inválida').or(z.date()),
  clientName: z.string().optional(),
  clientPhone: z.string().optional(),
})

export const UpdateAppointmentSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().optional(),
  startTime: z.string().datetime().or(z.date()).optional(),
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED']).optional(),
})

// ==================== SETTINGS ====================

export const UpdateTenantSettingsSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Cor inválida')
    .optional(),
  logoUrl: z.string().url('URL inválida').optional(),
  businessName: z.string().min(3).optional(),
  description: z.string().optional(),
  address: z.string().optional(),
  contactPhone: z.string().optional(),
  website: z.string().url('URL inválida').optional(),
  timezone: z.string().optional(),
  currency: z.string().length(3, 'Código de moeda inválido').optional(),
  reminderEnabled: z.boolean().optional(),
  reminderMinutes: z.number().int().min(0).optional(),
})

export const UpdateBusinessHourSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6, 'Dia da semana inválido (0-6)'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido (HH:MM)'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido (HH:MM)'),
  isOpen: z.boolean().default(true),
})

// ==================== WHATSAPP ====================

export const StartWhatsAppSessionSchema = z.object({
  sessionName: z
    .string()
    .min(3, 'Nome da sessão deve ter no mínimo 3 caracteres')
    .default('Principal'),
  agentId: z.string().uuid('ID do agente inválido').optional(),
})

export const SendWhatsAppMessageSchema = z.object({
  phone: z.string().regex(/^\d{10,15}$/, 'Número de telefone inválido'),
  text: z.string().min(1, 'Mensagem não pode ser vazia'),
})

// ==================== TYPES ====================

export type LoginDTO = z.infer<typeof LoginSchema>
export type RegisterDTO = z.infer<typeof RegisterSchema>
export type CreateAgentDTO = z.infer<typeof CreateAgentSchema>
export type UpdateAgentDTO = z.infer<typeof UpdateAgentSchema>
export type CreateServiceDTO = z.infer<typeof CreateServiceSchema>
export type UpdateServiceDTO = z.infer<typeof UpdateServiceSchema>
export type CreateAppointmentDTO = z.infer<typeof CreateAppointmentSchema>
export type UpdateAppointmentDTO = z.infer<typeof UpdateAppointmentSchema>
export type UpdateTenantSettingsDTO = z.infer<typeof UpdateTenantSettingsSchema>
export type UpdateBusinessHourDTO = z.infer<typeof UpdateBusinessHourSchema>
export type StartWhatsAppSessionDTO = z.infer<typeof StartWhatsAppSessionSchema>
export type SendWhatsAppMessageDTO = z.infer<typeof SendWhatsAppMessageSchema>
