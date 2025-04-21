// index.js - Servidor Express + Venom Bot

// 0️⃣ Carrega variáveis de ambiente
require('dotenv').config();
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
console.log('⚙️ Loaded ENV:', { N8N_WEBHOOK_URL });

const express = require('express');
const venom = require('venom-bot');

const app = express();
const PORT = process.env.PORT || 3000;
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

// Health check (sempre ativo)
app.get('/', (_req, res) => res.status(200).send('OK'));

// 3️⃣ Handler único para GET e POST /send (fluxo de disparo de mensagens da planilha)
async function sendHandler(req, res) {
  const isGet = req.method === 'GET';
  if (isGet) console.log('📥 GET Params:', req.query);

  const phone = isGet ? req.query.phone : req.body.phone;
  const message = isGet ? req.query.message : req.body.message;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone e message obrigatórios' });
  }

  if (!client) {
    console.error('❌ Bot ainda não inicializado.');
    return res.status(503).json({ success: false, error: 'Bot não está pronto.' });
  }

  try {
    await client.sendText(`${phone}@c.us`, message);
    return res.json({ success: true });
  } catch (err) {
    console.error(`❌ Erro ${isGet ? 'GET' : 'POST'} /send:`, err);
    const errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
    return res.status(500).json({ success: false, error: errorMessage });
  }
}
app.get('/send', sendHandler);
app.post('/send', sendHandler);

// 4️⃣ Inicia o servidor HTTP antes do Venom
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

// 5️⃣ Inicializa o Venom Bot e listener de mensagens (fluxo inbound)
venom
  .create({
    session: '/app/tokens/bot-session',
    headless: 'new',
    useChrome: true,
    executablePath: '/usr/bin/google-chrome-stable',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
    ],
  })
  .then((c) => {
    client = c;
    console.log('✅ Bot autenticado e pronto.');

    client.onMessage(async (msg) => {
      console.log('🔔 Mensagem recebida:', msg.from, msg.body);
      if (msg.isGroupMsg || !msg.body) return;

      const payload = {
        telefone: msg.from,      // +5511...
        mensagem: msg.body,      // texto recebido
        nome:     msg.sender?.pushname || '',
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
          console.error('❌ n8n webhook error:', response.status, text);
        } else {
          console.log('✅ Dados de inbound enviados ao n8n.');
        }
      } catch (err) {
        console.error('❌ Falha ao enviar inbound ao n8n:', err);
      }
    });
  })
  .catch((err) => {
    console.error('❌ Erro ao iniciar Venom Bot:', err);
    process.exit(1);
  });
EOF
