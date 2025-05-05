// index.js - Servidor Express + Venom Bot

// 0️⃣ Carrega variáveis de ambiente
require('dotenv').config();
const express = require('express');
const venom   = require('venom-bot');
const axios   = require('axios');

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const PORT = process.env.PORT;

console.log('⚙️ Loaded ENV:', { N8N_WEBHOOK_URL });

// --- Servidor HTTP ---------------------------------------------------------

const app = express();
app.use(express.json({
  strict: true,
  verify(req, _res, buf) {
    try { JSON.parse(buf); }
    catch (err) {
      console.error('❌ JSON inválido recebido:', buf.toString());
      throw err;
    }
  }
}));
app.use((req, _res, next) => {
  if (req.method === 'POST' && req.body) {
    console.log('📥 RAW BODY:', JSON.stringify(req.body));
  }
  next();
});

app.get('/', (_req, res) => res.status(200).send('OK'));

async function sendHandler(req, res) {
  const isGet   = req.method === 'GET';
  const phone   = isGet ? req.query.phone   : req.body.phone;
  const message = isGet ? req.query.message : req.body.message;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone e message obrigatórios' });
  }
  if (!global.client) {
    console.error('❌ Bot ainda não inicializado.');
    return res.status(503).json({ success: false, error: 'Bot não está pronto.' });
  }

  try {
    await global.client.sendText(`${phone}@c.us`, message);
    return res.json({ success: true });
  } catch (err) {
    console.error(`❌ Erro ${isGet ? 'GET' : 'POST'} /send:`, err);
    const errorMessage = err.message || JSON.stringify(err);
    return res.status(500).json({ success: false, error: errorMessage });
  }
}

app.get('/send', sendHandler);
app.post('/send', sendHandler);

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

// --- Função de inicialização do Venom -------------------------------------

async function initVenom() {
  try {
    const client = await venom.create({
      session: '/app/tokens/bot-session',
      headless: 'new',
      cachePath: './sessions',
      multidevice: true,
      browserArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-software-rasterizer',
        '--disable-dev-tools',
        '--remote-debugging-port=9222'
      ],
    });

    global.client = client;
    console.log('✅ Bot autenticado e pronto.');

    // 🔄 Reconexão automática em caso de expiração de sessão
    client.onStateChange(state => {
      console.log(`StateChange: ${state}`);
      if (['CONFLICT', 'UNPAIRED', 'UNLAUNCHED'].includes(state)) {
        console.warn('⚠️ Sessão expirada — reiniciando Venom em 5s...');
        client.close();
        setTimeout(initVenom, 5000);
      }
    });

    // 📲 Handler de mensagens: envia para o n8n
    client.onMessage(async message => {
      console.log(`🔔 Mensagem recebida de ${message.from}: "${message.body}"`);
      const payload = {
        telefone: message.from,
        mensagem: message.body || '',
        nome:     message.sender?.pushname || 'Desconhecido',
      };
      try {
        const res = await axios.post(N8N_WEBHOOK_URL, payload, { timeout: 5000 });
        console.log(`✅ Webhook chamado com status ${res.status}`);
      } catch (err) {
        console.error('❌ Erro ao chamar webhook:', err.message);
      }
    });

  } catch (err) {
    console.error('❌ Erro ao iniciar Venom Bot:', err);
    // tenta reiniciar após 10 segundos
    setTimeout(initVenom, 10000);
  }
}

// Chamada inicial
initVenom();
