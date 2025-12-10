// check-models.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  console.log('🔍 Verificando modelos disponíveis para sua chave...');
  
  try {
    // Truque: O SDK Node não tem listModels fácil, então testamos o flash padrão
    const model = genAI.getGenerativeModel({ model: '1.5-flash' });
    const result = await model.generateContent('Teste de conexão. Responda OK.');
    console.log('✅ SUCESSO! O modelo "1.5-flash" está funcionando.');
    console.log('Resposta:', result.response.text());
  } catch (error: any) {
    console.error('❌ Falha com 1.5-flash:', error.message);
    
    console.log('\n🔄 Tentando fallback para "gemini-pro"...');
    try {
      const model2 = genAI.getGenerativeModel({ model: 'gemini-pro' });
      await model2.generateContent('Teste');
      console.log('✅ "gemini-pro" funciona! Use este no seu código.');
    } catch (e) {
      console.error('❌ "gemini-pro" também falhou.');
    }
  }
}

run();