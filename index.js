// index.js – Servidor Express + Bot WhatsApp (texto, áudio e imagens)
require('dotenv').config();
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

// Envio de mensagens via endpoint
async function sendHandler(req, res) {
  const { phone, message } = req.method === 'GET'
    ? { phone: req.query.phone, message: req.query.message }
    : req.body;
  if (!phone || !message) return res.status(400).json({ success: false, error: 'phone e message são obrigatórios.' });
  if (!global.client) return res.status(503).json({ success: false, error: 'Bot não pronto.' });
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

// Inicia o bot
async function startBot() {
  try {
    const client = await venom.create({ session: SESSION_NAME, multidevice: true, headless: 'new', disableSpins: true, disableWelcome: true, autoClose: 0 });
    global.client = client;
    console.log('✅ Bot pronto.');

    // Heartbeat e watchdog de 15 min
    let ultimoEvento = Date.now();
    setInterval(async () => {
      try { await client.getHostDevice(); await client.sendPresenceAvailable(); }
      catch (e) { console.error('❌ Heartbeat falhou:', e.message); }
      if (Date.now() - ultimoEvento > 15 * 60 * 1000) process.exit(1);
    }, 5 * 60 * 1000);

    client.onStateChange(state => {
      const icons = { CONNECTED: '✅', TIMEOUT: '⏰', UNPAIRED: '🔌', CONFLICT: '⚠️', DISCONNECTED: '❗' };
      console.log(`${icons[state]||'❔'} Estado: ${state}`);
      if (['CONFLICT','UNPAIRED','TIMEOUT','DISCONNECTED'].includes(state)) client.restartService().catch(() => process.exit(1));
    });

    const imageBuffer = new Map();

    client.onMessage(async message => {
      ultimoEvento = Date.now();
      const from = message.from;
      const mimetype = message.mimetype || '';
      // Preview sem undefined, incluindo áudio
      const preview =
        message.type === 'chat' ? message.body :
        message.caption ? message.caption :
        message.type === 'ptt' ? '<áudio recebido>' :
        mimetype.startsWith('image/') ? '<imagem recebida>' :
        message.isMedia ? `<${message.type} recebido>` :
        '';
      console.log(`🔔 Mensagem de ${from} [${message.type}]:`, preview);

      // Texto puro
      if (message.type === 'chat') {
        const text = message.body.trim();
        await sendToN8n({ telefone: from, mensagem: text, type: 'text' });
        return;
      }

      // Áudio (voz)
      if (message.type === 'ptt') {
        try {
          const media = await client.decryptFile(message);
          const buffer = Buffer.from(media.data, 'base64');
          // Transcrição Whisper
          const form = new FormData();
          form.append('file', buffer, 'audio.ogg');
          form.append('model', 'whisper-1');
          form.append('response_format', 'text');
          const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, { headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` } });
          const transcription = resp.data?.trim() || '';
          // Envia áudio + transcrição
          await sendToN8n({ telefone: from, type: 'audio', audio: buffer.toString('base64'), textoTranscrito: transcription });
          console.log('✅ Áudio e transcrição enviados.');
        } catch (e) {
          console.error('❌ Erro no áudio:', e.message);
        }
        return;
      }

      // Imagem (agrupada)
      if (mimetype.startsWith('image/')) {
        try {
          const media = await client.decryptFile(message);
          const entry = imageBuffer.get(from) || [];
          entry.push({ filename: message.filename||`${Date.now()}`, mimetype, base64: media.toString('base64') });
          imageBuffer.set(from, entry);
          clearTimeout(entry._timeout);
          entry._timeout = setTimeout(async () => {
            await sendToN8n({ telefone: from, type: 'imagens', imagens: entry });
            imageBuffer.delete(from);
            console.log('✅ Imagens agrupadas enviadas.');
          }, 7000);
        } catch (err) {
          console.error('❌ Erro na imagem:', err.message);
        }
        return;
      }

      // Outros tipos
      console.log(`⚠️ Ignorado tipo: ${message.type}`);
    });

    // Helper de envio ao n8n
    async function sendToN8n(payload) {
      try {
        const res = await axios.post(N8N_WEBHOOK_URL, payload, { timeout: 10000 });
        console.log(`✅ Enviado ao n8n (status ${res.status}).`);
      } catch (err) {
        console.error('❌ Falha n8n:', err.message);
      }
    }

  } catch (err) {
    console.error('❌ Falha ao iniciar bot:', err);
    process.exit(1);
  }
}

startBot();
