import { PrismaClient } from '@prisma/client'
import { 
    initAuthCreds, 
    BufferJSON, 
    AuthenticationCreds, 
    AuthenticationState,
    SignalDataTypeMap
} from '@whiskeysockets/baileys'
import { logger } from './logger'

/**
 * Adaptador de Autenticação Baileys <-> Prisma
 * Permite salvar a sessão do WhatsApp no banco de dados, possibilitando persistência e multi-sessão.
 */
export const usePrismaAuthState = async (prisma: PrismaClient, sessionId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
    
    // 1. Recuperar credenciais principais (creds.json)
    const credsKey = await prisma.whatsAppAuthKey.findUnique({
        where: { sessionId_keyId: { sessionId, keyId: 'creds' } }
    })

    // Se existirem chaves, hidrata o objeto; senão, inicia novas credenciais
    const creds: AuthenticationCreds = credsKey?.value 
        ? JSON.parse(JSON.stringify(credsKey.value), BufferJSON.reviver) 
        : initAuthCreds()

    return {
        state: {
            creds,
            keys: {
                // Recupera chaves específicas (app-state, sender-key, etc)
                get: async (type, ids) => {
                    const data: { [key: string]: SignalDataTypeMap[typeof type] } = {}
                    
                    const keys = await prisma.whatsAppAuthKey.findMany({
                        where: {
                            sessionId,
                            keyId: { in: ids },
                            type
                        }
                    })

                    for (const k of keys) {
                        data[k.keyId] = JSON.parse(JSON.stringify(k.value), BufferJSON.reviver)
                    }

                    return data
                },
                
                // Salva ou deleta chaves em lote (Batch)
                set: async (data) => {
                    const tasks: any[] = []

                    for (const category in data) {
                        const keyCategory = category as keyof SignalDataTypeMap
                        const categoryData = data[keyCategory]

                        if (!categoryData) continue

                        for (const id in categoryData) {
                            const value = categoryData[id]
                            const keyId = id
                            
                            // Se value existe, é um UPSERT. Se for null/undefined, é um DELETE.
                            if (value) {
                                tasks.push(prisma.whatsAppAuthKey.upsert({
                                    where: { sessionId_keyId: { sessionId, keyId } },
                                    create: { 
                                        sessionId, 
                                        keyId, 
                                        type: keyCategory, 
                                        value: JSON.parse(JSON.stringify(value, BufferJSON.replacer)) 
                                    },
                                    update: { 
                                        value: JSON.parse(JSON.stringify(value, BufferJSON.replacer)) 
                                    }
                                }))
                            } else {
                                tasks.push(prisma.whatsAppAuthKey.deleteMany({
                                    where: { sessionId, keyId }
                                }))
                            }
                        }
                    }

                    // Executa todas as operações em uma única transação para integridade
                    if(tasks.length > 0) {
                        try {
                            await prisma.$transaction(tasks)
                        } catch (error: any) {
                            // Filtro de erro: P2025 (Record not found) é comum em deletes concorrentes e pode ser ignorado.
                            // Outros erros são logados para auditoria.
                            if (error.code !== 'P2025') {
                                logger.error({ error: error.message, code: error.code }, '❌ Erro ao sincronizar chaves do Baileys no banco')
                            }
                        }
                    }
                }
            }
        },
        // Função dedicada para salvar apenas as credenciais principais
        saveCreds: async () => {
            try {
                await prisma.whatsAppAuthKey.upsert({
                    where: { sessionId_keyId: { sessionId, keyId: 'creds' } },
                    create: { 
                        sessionId, 
                        keyId: 'creds', 
                        type: 'creds', 
                        value: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)) 
                    },
                    update: { 
                        value: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)) 
                    }
                })
            } catch (e) {
                logger.error('❌ Falha crítica ao salvar credenciais principais (creds)')
            }
        }
    }
}