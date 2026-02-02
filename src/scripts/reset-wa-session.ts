import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function resetSession(sessionId: string) {
  console.log(`🗑️  Limpando sessão: ${sessionId}...`)

  try {
    // 1. Remove chaves de autenticação (creds, app-state, etc)
    const deletedKeys = await prisma.whatsAppAuthKey.deleteMany({
      where: { sessionId },
    })
    console.log(`✅ ${deletedKeys.count} chaves removidas.`)

    // 2. Atualiza status da sessão para DISCONNECTED
    await prisma.whatsAppSession.update({
      where: { id: sessionId },
      data: { status: 'DISCONNECTED' },
    })
    console.log('✅ Status da sessão atualizado para DISCONNECTED.')

    console.log('\n🚀 Sessão resetada com sucesso! Agora você pode escanear o QR Code novamente.')
  } catch (error) {
    console.error('❌ Erro ao limpar sessão:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Pega o ID da sessão dos argumentos (ex: tsx reset-wa-session.ts <SESSION_ID>)
const sessionId = process.argv[2]

if (!sessionId) {
  console.error('⚠️  Uso: npx tsx src/scripts/reset-wa-session.ts <SESSION_ID>')
  process.exit(1)
}

resetSession(sessionId)
