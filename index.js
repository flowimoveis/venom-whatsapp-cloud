// index.js – Servidor Express + Venom Bot (texto, áudio e imagens)
require('dotenv').config();
const express = require('express');
const venom = require('venom-bot');
const axios = require('axios');
const FormData = require('form-data');

process.env.CHROME_BIN = '/usr/bin/google-chrome-stable';
process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/google-chrome-stable';
const SESSION_PATH = '/tmp/bot-session';

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const PORT = process.env.PORT || 3000;


process.on('unhandledRejection', (reason, p) => {
  console.error('🚨 Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', err => {
  console.error('🚨 Uncaught Exception:', err);
});

console.log('⚙️ ENV:', { N8N_WEBHOOK_URL, PORT });

const app = express();
app.use(express.json({
  strict: true,
  verify(req, _res, buf) {
    try { JSON.parse(buf); }
    catch (err) {
      console.error('❌ JSON inválido:', buf.toString());
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

app.get('/', (_req, res) => res.send('OK'));

async function sendHandler(req, res) {
  const isGet = req.method === 'GET';
  const phone = isGet ? req.query.phone : req.body.phone;
  const message = isGet ? req.query.message : req.body.message;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone e message obrigatórios' });
  }
  if (!global.client) {
    return res.status(503).json({ success: false, error: 'Bot não está pronto.' });
  }
  try {
    await global.client.sendText(`${phone}@c.us`, message);
    return res.json({ success: true });
  } catch (err) {
    console.error(`❌ Erro /send:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
app.get('/send', sendHandler);
app.post('/send', sendHandler);

app.listen(PORT, () => {
  console.log(`🚀 Express rodando na porta ${PORT}`);
});

async function initVenom() {
  try {
const client = await venom.create({
  session: SESSION_PATH,
  multidevice: true,
  headless: 'new',
  disableSpins: true,
  disableWelcome: true,
  autoClose: 0,
  browserArgs: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--single-process',
    '--no-zygote',
    '--disable-software-rasterizer',
    '--remote-debugging-port=9222'
  ],
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
});

    global.client = client;
    console.log('✅ Bot autenticado e pronto.');

    setInterval(async () => {
      try {
        await client.getHostDevice();
        await client.sendPresenceAvailable();
        console.log('📡 Heartbeat enviado.');
      } catch (e) {
        console.error('❌ Heartbeat falhou:', e.message);
      }
    }, 5 * 60 * 1000);

    let ultimoEvento = Date.now();
    setInterval(() => {
      if ((Date.now() - ultimoEvento) > 15 * 60 * 1000) {
        console.error('🛑 Sem eventos >15min, saindo para PM2 reiniciar');
        process.exit(1);
      }
    }, 5 * 60 * 1000);

    client.onStateChange(state => {
      const icons = {
        CONNECTED: '✅', TIMEOUT: '⏰', UNPAIRED: '🔌',
        CONFLICT: '⚠️', DISCONNECTED: '❗'
      };
      console.log(`${icons[state] || '❔'} State: ${state}`);
      if (['CONFLICT', 'UNPAIRED', 'TIMEOUT', 'DISCONNECTED'].includes(state)) {
        client.restartService()
          .then(() => console.log('🔁 Serviço reiniciado.'))
          .catch(() => process.exit(1));
      }
    });

    const imageBuffer = new Map();

    client.onMessage(async message => {
      ultimoEvento = Date.now();
      const from = message.from;
      const type = message.type;
      let text = '';

      console.log('🔍 onMessage payload:', JSON.stringify(message, null, 2));

      if (type === 'chat') {
        text = message.body;
      } else if (type === 'ptt') {
        try {
          const media = await client.decryptFile(message);
          const buffer = Buffer.from(media.data, 'base64');

          const form = new FormData();
          form.append('file', buffer, 'audio.ogg');
          form.append('model', 'whisper-1');
          form.append('response_format', 'text');

          const resp = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            form,
            {
              headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              },
            }
          );
          text = resp.data.trim();
        } catch (e) {
          console.error('❌ Transcrição falhou:', e.message);
          return;
        }
      } else if (message.isMedia || type === 'image') {
        try {
          const media = await client.decryptFile(message);
          const base64 = media.toString('base64');
          const mimetype = message.mimetype || 'image/jpeg';
          const filename = message.filename || `${Date.now()}.jpg`;

          if (!imageBuffer.has(from)) {
            imageBuffer.set(from, []);
          }

          const entry = imageBuffer.get(from);
          entry.push({ filename, base64, mimetype });

          clearTimeout(entry._timeout);
          entry._timeout = setTimeout(async () => {
            const imagens = imageBuffer.get(from).filter(i => i.filename);
            imageBuffer.delete(from);

            try {
              await axios.post(
                N8N_WEBHOOK_URL,
                {
                  telefone: from,
                  type: 'imagens',
                  imagens
                },
                { timeout: 10000 }
              );
              console.log(`✅ Enviadas ${imagens.length} imagem(ns) agrupadas ao n8n`);
            } catch (err) {
              console.error('❌ Erro ao enviar imagens agrupadas:', err.message);
            }
          }, 7000);
        } catch (e) {
          console.error('❌ Erro ao processar imagem:', e.message);
        }
        return;
      } else {
        console.log(`⚠️ Ignorando tipo "${type}"`);
        return;
      }

      if (!text) {
        console.log(`⚠️ Texto vazio, ignorado.`);
        return;
      }

      console.log(`🔔 Mensagem de ${from} (type=${type}): "${text}"`);

      try {
        const res = await axios.post(
          N8N_WEBHOOK_URL,
          { telefone: from, mensagem: text, type },
          { timeout: 5000 }
        );
        console.log(`✅ Dados enviados ao n8n com status ${res.status}`);
      } catch (err) {
        console.error('❌ Erro ao chamar webhook:', err.message);
      }
    });

  } catch (err) {
    console.error('❌ initVenom falhou:', err.stack || err);
    process.exit(1);
  }
}

initVenom();
