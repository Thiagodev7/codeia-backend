import { PrismaClient } from '@prisma/client'
import { 
    initAuthCreds, 
    BufferJSON, 
    AuthenticationCreds, 
    AuthenticationState,
    SignalDataTypeMap
} from '@whiskeysockets/baileys'
import { logger } from './logger'

export const usePrismaAuthState = async (prisma: PrismaClient, sessionId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
    
    // 1. Recuperar credenciais
    const credsKey = await prisma.whatsAppAuthKey.findUnique({
        where: { sessionId_keyId: { sessionId, keyId: 'creds' } }
    })

    const creds: AuthenticationCreds = credsKey?.value 
        ? JSON.parse(JSON.stringify(credsKey.value), BufferJSON.reviver) 
        : initAuthCreds()

    return {
        state: {
            creds,
            keys: {
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
                set: async (data) => {
                    const tasks: any[] = []

                    for (const category in data) {
                        const keyCategory = category as keyof SignalDataTypeMap
                        const categoryData = data[keyCategory]

                        if (!categoryData) continue

                        for (const id in categoryData) {
                            const value = categoryData[id]
                            const keyId = id
                            
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

                    // --- MELHORIA: Tratamento de Erros na Transação ---
                    if(tasks.length > 0) {
                        try {
                            await prisma.$transaction(tasks)
                        } catch (error: any) {
                            // Loga o erro real para não ficarmos cegos com "error: {}"
                            // Ignora erro de "Record not found" em deletes concorrentes
                            if (error.code !== 'P2025') {
                                logger.error({ error: error.message, code: error.code }, '❌ Erro ao salvar chaves do Baileys')
                            }
                        }
                    }
                }
            }
        },
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
                logger.error('Falha ao salvar creds principais')
            }
        }
    }
}