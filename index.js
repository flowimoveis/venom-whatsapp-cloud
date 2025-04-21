// index.js - Servidor Express + Venom Bot

// 0️⃣ Carrega variáveis de ambiente
require('dotenv').config();
console.log('⚙️ Loaded ENV:', { N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL });

const express = require('express');
const fetch = require('node-fetch');
const venom = require('venom-bot');

const app = express();
const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
let client;

// 1️⃣ Middleware: parse JSON com verificação de sintaxe
app.use(express.json({
  strict: true,
  verify(req, _res, buf) {
    try {
      JSON.parse(buf);
    } catch (err) {
      console.error('❌ JSON inválido recebido:', buf.toString());
      throw err;
    }
  },
}));

// 2️⃣ Middleware de logging do body bruto (após parse)
app.use((req, _res, next) => {
  if (req.method === 'POST' && req.body) {
    console.log('📥 RAW BODY:', JSON.stringify(req.body));
  }
  next();
});

// Health check
app.get('/', (_req, res) => res.status(200).send('OK'));

// 3️⃣ Handler único para GET e POST /send
async function sendHandler(req, res) {
  const isGet = req.method === 'GET';
  if (isGet) console.log('📥 GET Params:', req.query);

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
    console.error(err.stack || err);
    return res.status(500).json({ success: false, error: err.message || err.toString() });
  }
}
app.get('/send', sendHandler);
app.post('/send', sendHandler);

// 4️⃣ Inicia o servidor HTTP imediatamente
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

// 5️⃣ Inicializa o Venom Bot e adiciona listener
venom
  .create({
    session: '/app/tokens/bot-session',
    headless: true,
    useChrome: true,
  })
  .then((c) => {
    client = c;
    console.log('✅ Bot autenticado e pronto.');

    client.onMessage(async (msg) => {
      console.log('🔔 Mensagem recebida:', msg.from, msg.body);
      if (msg.isGroupMsg || !msg.body) return;

      const payload = {
        telefone: msg.from,
        mensagem: msg.body,
        nome: msg.sender?.pushname || '',
      };

      if (!N8N_WEBHOOK_URL) {
        console.warn('⚠️ N8N_WEBHOOK_URL não definido no .env');
        return;
      }

      try {
        const response = await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
  })
  .catch((err) => {
    console.error('❌ Erro ao iniciar Venom Bot:', err);
    process.exit(1);
  });
