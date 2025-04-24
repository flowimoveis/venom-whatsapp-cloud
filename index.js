// index.js - Servidor Express + Venom Bot

// 0️⃣ Carrega variáveis de ambiente
require('dotenv').config();
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
console.log('⚙️ Loaded ENV:', { N8N_WEBHOOK_URL });

const express = require('express');
const fetch   = require('node-fetch');       // ← Import do fetch
const venom   = require('venom-bot');
const axios = require('axios');

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

// 3️⃣ Handler único para GET e POST /send
async function sendHandler(req, res) {
  const isGet   = req.method === 'GET';
  if (isGet) console.log('📥 GET Params:', req.query);

  const phone   = isGet ? req.query.phone   : req.body.phone;
  const message = isGet ? req.query.message : req.body.message;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone e message obrigatórios' });
  }
  if (!client) {
    console.error('❌ Bot ainda não inicializado.');
    return res.status(503).json({ success: false, error: 'Bot não está pronto.' });
  }

  try {
    await client.sendText(${phone}@c.us, message);
    return res.json({ success: true });
  } catch (err) {
    console.error(❌ Erro ${isGet ? 'GET' : 'POST'} /send:, err);
    const errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
    return res.status(500).json({ success: false, error: errorMessage });
  }
}
app.get('/send', sendHandler);
app.post('/send', sendHandler);

// 4️⃣ Inicia o servidor HTTP
app.listen(PORT, () => {
  console.log(🚀 Servidor rodando na porta ${PORT});
});

// 5️⃣ Inicializa o Venom Bot e registra listener de mensagens
 venom
  .create({
    session: '/app/tokens/bot-session',
    headless: true,  // usa o modo antigo estável
    useChrome: true,
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
  })
  .then((c) => {
    client = c;
    console.log('✅ Bot autenticado e pronto.');

client.onMessage(async (message) => {
  // ... código anterior de montagem de payload
  const payload = {
    telefone: telefoneRaw,
    mensagem: message.body,
    nome: message.sender?.pushname || "Desconhecido",
  };

  console.log('➡️ Enviando ao n8n payload:', payload);

  try {
    const response = await axios.post(webhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.status >= 200 && response.status < 300) {
      console.log('✅ Dados enviados ao n8n com sucesso:', response.data);
    } else {
      console.error('⚠️ n8n respondeu com erro:', response.status, response.data);
    }
  } catch (err) {
    console.error('❌ Falha ao enviar para o n8n:', err.message);
  }
});

  })
  .catch((err) => {
    console.error('❌ Erro ao iniciar Venom Bot:', err);
    process.exit(1);
  });
