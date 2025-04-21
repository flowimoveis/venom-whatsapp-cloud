// index.js - Servidor Express + Venom Bot

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const venom = require('venom-bot');

const app = express();
const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = https://flowimoveis.app.n8n.cloud/webhook/41bde738-3535-431f-86c8-58c45346a085;
let client;

// 1️⃣ Middleware: parse JSON com verificação e log do body
app.use(express.json({
  strict: true,
  verify: (req, _res, buf) => {
    try {
      JSON.parse(buf);
    } catch (err) {
      console.error('❌ JSON inválido recebido:', buf.toString());
      throw err;
    }
  }
}));
app.use((req, res, next) => {
  if (req.method === 'POST') {
    console.log('📥 RAW BODY:', JSON.stringify(req.body));
  }
  next();
});

// 2️⃣ Endpoints HTTP

// Health check
app.get('/', (_req, res) => res.status(200).send('OK'));

// Handler único para GET e POST /send
async function sendHandler(req, res) {
  const isGet = req.method === 'GET';
  const phone = isGet ? req.query.phone : req.body.phone;
  const message = isGet ? req.query.message : req.body.message;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone e message obrigatórios' });
  }

  try {
    await client.sendText(`${phone}@c.us`, message);
    return res.json({ success: true });
  } catch (err) {
    console.error(`❌ Erro ${isGet ? 'GET' : 'POST'} /send:`, err);
    return res.status(500).json({ success: false, error: err.toString() });
  }
}

// Rotas de envio
app.get('/send', sendHandler);
app.post('/send', sendHandler);

// 3️⃣ Inicializa Venom Bot e inicia o servidor em seguida
venom
  .create({
    session: '/app/tokens/bot-session',
    headless: true,
    useChrome: true
  })
  .then((c) => {
    client = c;
    console.log('✅ Bot autenticado e pronto.');

    // Listener para mensagens recebidas
    client.onMessage(async (msg) => {
      if (msg.isGroupMsg || !msg.body) return;
      const payload = {
        telefone: msg.from,
        mensagem: msg.body,
        nome: msg.sender?.pushname || ''
      };

      if (!N8N_WEBHOOK_URL) {
        console.warn('⚠️ N8N_WEBHOOK_URL não definido no .env');
        return;
      }

      try {
        const response = await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const text = await response.text();
          console.error('❌ N8N webhook error:', response.status, text);
        } else {
          console.log('✅ Dados enviados ao n8n.');
        }
      } catch (err) {
        console.error('❌ Falha ao enviar ao n8n:', err);
      }
    });

    // Aguarda o client estar pronto antes de ouvir na porta
    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Erro ao iniciar Venom Bot:', err);
    process.exit(1);
  });
