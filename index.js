// index.js – Servidor Express + Bot WhatsApp (texto, áudio e imagens)
require('dotenv').config();
process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/google-chrome-stable';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';

const express = require('express');
const venom = require('venom-bot');
const axios = require('axios');
const FormData = require('form-data');

const SESSION_NAME = 'bot-session';
const { N8N_WEBHOOK_URL, PORT = 3000, OPENAI_API_KEY } = process.env;

// Validações iniciais
if (!N8N_WEBHOOK_URL) {
  console.error('❌ N8N_WEBHOOK_URL não definido.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY não definido.');
  process.exit(1);
}

// Configura servidor HTTP
const app = express();
app.use(express.json({ strict: true, verify(req, _res, buf) { JSON.parse(buf); } }));
app.use((req, _res, next) => {
  if (req.method === 'POST' && req.body) console.log('📥 BODY RECEBIDO:', JSON.stringify(req.body));
  next();
});
app.get('/', (_req, res) => res.send('OK'));

// Endpoint para envio de mensagens
async function sendHandler(req, res) {
  const { phone, message } = req.method === 'GET'
    ? { phone: req.query.phone, message: req.query.message }
    : req.body;
  if (!phone || !message)
    return res.status(400).json({ success: false, error: 'phone e message são obrigatórios.' });
  if (!global.client)
    return res.status(503).json({ success: false, error: 'Bot não pronto.' });
  try {
    await global.client.sendText(`${phone}@c.us`, message);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Falha ao enviar:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
app.route('/send').get(sendHandler).post(sendHandler);
app.listen(PORT, () => console.log(`🚀 Servindo na porta ${PORT}`));

// Helper para enviar payloads ao n8n
async function sendToN8n(payload) {
  if (!N8N_WEBHOOK_URL) {
    console.error('❌ N8N_WEBHOOK_URL não definido, não é possível enviar ao n8n.');
    return;
  }
  try {
    await axios.post(N8N_WEBHOOK_URL, payload);
    console.log('✅ Payload enviado ao n8n');
  } catch (err) {
    console.error('❌ Falha ao enviar para o n8n:', err.message);
  }
}

// Inicialização do bot
async function startBot() {
  try {
    // Cria o client e guarda em global.client
    const client = await venom.create({
      session: SESSION_NAME,
      multidevice: true,
      headless: 'new',
      disableSpins: true,
      disableWelcome: true,
      autoClose: 0,
      browserArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    });
    global.client = client;
    console.log('✅ Bot pronto.');

    // Heartbeat e watchdog de 15 min
    let ultimoEvento = Date.now();
    setInterval(async () => {
      try {
        await client.getHostDevice();
        await client.sendPresenceAvailable();
      } catch (e) {
        console.error('❌ Heartbeat falhou:', e.message);
      }
      if (Date.now() - ultimoEvento > 15 * 60 * 1000) process.exit(1);
    }, 5 * 60 * 1000);

    // Trata mudança de estado
    client.onStateChange(state => {
      const icons = {
        CONNECTED: '✅',
        TIMEOUT: '⏰',
        UNPAIRED: '🔌',
        CONFLICT: '⚠️',
        DISCONNECTED: '❗',
      };
      console.log(`${icons[state] || '❔'} Estado: ${state}`);
      if (['CONFLICT', 'UNPAIRED', 'TIMEOUT', 'DISCONNECTED'].includes(state))
        client.restartService().catch(() => process.exit(1));
    });

    // Buffer para agrupamento de imagens
    const imageBuffer = new Map();

    // Handler de mensagens
    client.onMessage(async message => {
      console.log('📩 RECEBENDO UMA NOVA MENSAGEM...');
      ultimoEvento = Date.now();
      const from = message.from;
      const tipo = message.type;
      console.log(`📨 Tipo: ${tipo}`, `📨 Mimetype: ${message.mimetype}`, `📨 MediaType: ${message.mediaData?.type}`);

      // Texto puro
      if (tipo === 'chat') {
        const payload = { telefone: from, type: 'text', mensagem: message.body.trim() };
        console.log('▶️ Payload n8n:', JSON.stringify(payload, null, 2));
        await sendToN8n(payload);
        return;
      }

      // Áudio (ptt ou audio)
      if ((tipo === 'ptt' || tipo === 'audio') && message.mimetype?.includes('audio')) {
        try {
          const mediaBase64 = await client.decryptFile(message);
          const buffer = Buffer.from(mediaBase64, 'base64');
          const form = new FormData();
          form.append('file', buffer, 'audio.ogg');
          form.append('model', 'whisper-1');
          form.append('response_format', 'text');

          const resp = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            form,
            { headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` } }
          );
          const transcription = resp.data?.trim() || '';
          console.log(`📝 Transcrição: "${transcription}"`);

          const payload = {
            telefone: from,
            type: 'audio',
            mensagem: transcription,
            textoTranscrito: transcription,
            audio: mediaBase64,
          };
          console.log('▶️ Payload n8n:', JSON.stringify(payload, null, 2));
          await sendToN8n(payload);
          console.log('✅ Áudio enviado ao n8n.');
        } catch (e) {
          console.error('❌ Erro ao processar áudio:', e);
        }
        return;
      }

      // Imagem (agrupamento)
      if (message.mediaData?.type === 'image' || tipo === 'image') {
        try {
          const mediaBase64 = await client.decryptFile(message);
          const entry = imageBuffer.get(from) || [];
          entry.push({
            filename: message.filename || `${Date.now()}`,
            mimetype: message.mimetype,
            base64: mediaBase64,
          });
          imageBuffer.set(from, entry);
          clearTimeout(entry._timeout);
          entry._timeout = setTimeout(async () => {
            const payload = { telefone: from, type: 'imagens', imagens: entry };
            console.log('▶️ Payload n8n:', JSON.stringify(payload, null, 2));
            await sendToN8n(payload);
            imageBuffer.delete(from);
            console.log('✅ Imagens agrupadas enviadas.');
          }, 7000);
        } catch (err) {
          console.error('❌ Erro ao processar imagem:', err);
        }
        return;
      }

      // Outros tipos
      console.log(`⚠️ Ignorado tipo: ${tipo}`);
    });

  } catch (err) {
    console.error('❌ Falha na inicialização do bot:', err);
    process.exit(1);
  }
}

startBot();
