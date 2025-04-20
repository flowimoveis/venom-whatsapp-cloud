// index.js - Servidor Express + Venom Bot

const express = require('express');
const fetch = require('node-fetch');
const venom = require('venom-bot');

const app = express();
const PORT = process.env.PORT || 3000;
let client;

// 1️⃣ Middleware: parse JSON automaticamente e log do body
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
  if (req.method === 'POST' && req.body) {
    console.log('📥 RAW BODY:', JSON.stringify(req.body));
  }
  next();
});

// 2️⃣ Endpoints HTTP

// Health check
app.get('/', (_req, res) => res.status(200).send('OK'));

// Envio de mensagem: suporta GET e POST para facilidade de teste
app.route('/send')
  .get(async (req, res) => {
    const { phone, message } = req.query;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: 'phone e message obrigatórios' });
    }
    try {
      await client.sendText(`${phone}@c.us`, message);
      return res.json({ success: true });
    } catch (err) {
      console.error('❌ Erro GET /send:', err);
      return res.status(500).json({ success: false, error: err.toString() });
    }
  })
  .post(async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: 'phone e message obrigatórios' });
    }
    try {
      await client.sendText(`${phone}@c.us`, message);
      return res.json({ success: true });
    } catch (err) {
      console.error('❌ Erro POST /send:', err);
      return res.status(500).json({ success: false, error: err.toString() });
    }
  });

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
      try {
        const response = await fetch(
          'https://flowimoveis.app.n8n.cloud/webhook/fa8b2f28-34ef-4fbe-add6-446c64cf1fb2?type=production',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }
        );
        if (!response.ok) {
          console.error('❌ N8N webhook error:', await response.text());
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
