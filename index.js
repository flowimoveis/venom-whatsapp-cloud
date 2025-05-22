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
  console.error('❌ Variável de ambiente N8N_WEBHOOK_URL não definida.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('❌ Variável de ambiente OPENAI_API_KEY não definida.');
  process.exit(1);
}

// Configura servidor HTTP
const app = express();
app.use(express.json({
  strict: true,
  verify(req, _res, buf) {
    try {
      JSON.parse(buf);
    } catch (err) {
      console.error('❌ JSON inválido recebido:', buf.toString());
      throw err;
    }
  }
}));

// Logger de requests brutos
app.use((req, _res, next) => {
  if (req.method === 'POST' && req.body) {
    console.log('📥 BODY RECEBIDO:', JSON.stringify(req.body));
  }
  next();
});

app.get('/', (_req, res) => res.send('OK'));

// Handler unificado para envio de mensagens
async function sendHandler(req, res) {
  const { phone, message } = req.method === 'GET'
    ? { phone: req.query.phone, message: req.query.message }
    : req.body;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone e message são obrigatórios.' });
  }
  if (!global.client) {
    return res.status(503).json({ success: false, error: 'Bot não está pronto.' });
  }

  try {
    await global.client.sendText(`${phone}@c.us`, message);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Falha ao enviar mensagem:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
app.route('/send').get(sendHandler).post(sendHandler);

// Inicia servidor HTTP
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));

// Inicialização do bot WhatsApp
async function startBot() {
  try {
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
        '--disable-gpu',
        '--single-process',
        '--disable-software-rasterizer',
        '--remote-debugging-port=9222'
      ]
    });

    global.client = client;
    console.log('✅ Bot autenticado e pronto.');

    // Heartbeat a cada 5 minutos
    setInterval(async () => {
      try {
        await client.getHostDevice();
        await client.sendPresenceAvailable();
        console.log('📡 Heartbeat enviado.');
      } catch (heartbeatError) {
        console.error('❌ Heartbeat falhou:', heartbeatError.message);
      }
    }, 5 * 60 * 1000);

    // Watchdog: reinicia se não houver eventos por 15min
    let ultimoEvento = Date.now();
    setInterval(() => {
      if (Date.now() - ultimoEvento > 15 * 60 * 1000) {
        console.error('🛑 Sem eventos >15min, encerrando para reinicialização.');
        process.exit(1);
      }
    }, 5 * 60 * 1000);

    // Tratamento de mudança de estado
    client.onStateChange(state => {
      const icons = { CONNECTED: '✅', TIMEOUT: '⏰', UNPAIRED: '🔌', CONFLICT: '⚠️', DISCONNECTED: '❗' };
      console.log(`${icons[state] || '❔'} Estado: ${state}`);
      if (['CONFLICT', 'UNPAIRED', 'TIMEOUT', 'DISCONNECTED'].includes(state)) {
        client.restartService()
          .then(() => console.log('🔁 Serviço reiniciado.'))
          .catch(() => process.exit(1));
      }
    });

    // Buffer temporário para agrupar imagens
    const imageBuffer = new Map();

    // Manipulador de mensagens
    client.onMessage(async message => {
      ultimoEvento = Date.now();
      const from = message.from;
      let text = '';

      // Preview de conteúdo para logs, sem “undefined”
      const preview = message.type === 'chat'
        ? message.body
        : message.caption
          ? message.caption
          : message.isMedia
            ? `<${message.type} recebido>`
            : '';
      console.log(`🔔 Mensagem recebida de ${from} [${message.type}]:`, preview);

      switch (true) {
        case message.type === 'chat':
          text = message.body;
          break;

        case message.type === 'ptt': {
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
              { headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` } }
            );

            text = resp.data?.trim() || '';
            if (!text) console.warn('⚠️ Whisper retornou texto vazio.');
          } catch (err) {
            console.error('❌ Erro na transcrição:', err.message);
            return;
          }
          break;
        }

        case (message.isMedia || message.type === 'image') && message.caption:
          text = message.caption.trim();
          break;

        case message.isMedia || message.type === 'image': {
          try {
            const media = await client.decryptFile(message);
            const mimetype = message.mimetype || 'image/jpeg';
            const filename = message.filename || `${Date.now()}.jpg`;
            const base64 = media.toString('base64');

            if (!imageBuffer.has(from)) imageBuffer.set(from, []);
            const entry = imageBuffer.get(from);
            entry.push({ filename, base64, mimetype });

            clearTimeout(entry._timeout);
            entry._timeout = setTimeout(async () => {
              imageBuffer.delete(from);
              try {
                await axios.post(N8N_WEBHOOK_URL, { telefone: from, type: 'imagens', imagens: entry }, { timeout: 10000 });
                console.log(`✅ Enviadas ${entry.length} imagem(ns) agrupadas ao n8n.`);```
