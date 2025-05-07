// index.js - Servidor Express + Venom Bot com melhorias de estabilidade

require('dotenv').config();
const express = require('express');
const venom = require('venom-bot');
const axios = require('axios');
const fs = require('fs');

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const PORT = process.env.PORT;

process.on('unhandledRejection', (reason, p) => {
  console.error('🚨 Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', err => {
  console.error('🚨 Uncaught Exception:', err);
});

console.log('⚙️ Loaded ENV:', { N8N_WEBHOOK_URL, PORT });

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
  const isGet = req.method === 'GET';
  const phone = isGet ? req.query.phone : req.body.phone;
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
    return res.status(500).json({ success: false, error: err.message || JSON.stringify(err) });
  }
}

app.get('/send', sendHandler);
app.post('/send', sendHandler);

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

async function initVenom() {
  try {
    const client = await venom.create({
      session: '/app/tokens/bot-session',
      cachePath: './sessions',
      multidevice: true,
      headless: 'new',
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
      ]
    });

    global.client = client;
    console.log('✅ Bot autenticado e pronto.');

// 🔁 Heartbeat: mantém sessão ativa a cada 5 minutos
setInterval(async () => {
  try {
    await client.getHostDevice();
    await client.sendPresenceAvailable(); // reforça presença online
    console.log('📡 Heartbeat e presença enviados.');
  } catch (e) {
    console.error('❌ Heartbeat falhou:', e.message);
  }
}, 5 * 60 * 1000);

    // 🕒 Watchdog para reinício se travar
    let ultimoEvento = Date.now();

    setInterval(() => {
      const agora = Date.now();
      const minutosSemEvento = (agora - ultimoEvento) / 1000 / 60;
      if (minutosSemEvento > 15) {
        console.error(`🛑 Sem eventos há ${minutosSemEvento.toFixed(1)} minutos. Reiniciando...`);
        process.exit(1);
      }
    }, 5 * 60 * 1000);

    // 🧠 Estado da sessão
    client.onStateChange(async (state) => {
      const emoji = {
        'CONNECTED': '✅',
        'TIMEOUT': '⏰',
        'UNPAIRED': '🔌',
        'CONFLICT': '⚠️',
        'UNLAUNCHED': '🚫',
        'DISCONNECTED': '❗'
      }[state] || '❔';

      console.log(`${emoji} Estado atual: ${state}`);

      if (['CONFLICT','UNPAIRED','UNLAUNCHED','TIMEOUT','DISCONNECTED'].includes(state)) {
        console.warn(`⚠️ Tentando reiniciar sessão... (${state})`);
        try {
          await client.restartService();
          console.log('🔁 Serviço reiniciado com sucesso.');
        } catch (e) {
          console.error('❌ Falha ao reiniciar. Encerrando processo para PM2 reiniciar.', e.stack || e.message);
          process.exit(1);
        }
      }
    });

    // 📥 Mensagens recebidas
    client.onMessage(async message => {
      ultimoEvento = Date.now();
      console.log(`🔔 Mensagem recebida de ${message.from}: "${message.body}"`);
      const payload = {
        telefone: message.from,
        mensagem: message.body || '',
        nome: message.sender?.pushname || 'Desconhecido'
      };
      try {
        const res = await axios.post(N8N_WEBHOOK_URL, payload, { timeout: 5000 });
        console.log(`✅ Webhook chamado com status ${res.status}`);
      } catch (err) {
        console.error('❌ Erro ao chamar webhook:', err.message);
      }
    });

    client.onStreamChange(stream => console.log('🎥 StreamChange:', stream));
    client.onAck(ack => console.log('📬 Ack:', ack));

  } catch (err) {
    console.error('❌ InitVenom falhou com erro:', err.stack || err);
    process.exit(1);
  }
}

initVenom();
