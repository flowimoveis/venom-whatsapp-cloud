// index.js - Servidor Express + Venom Bot

// 0️⃣ Carrega variáveis de ambiente
require('dotenv').config();
const express       = require('express');
const venom         = require('venom-bot');
const axios         = require('axios');
const { LocalAuth } = require('venom-bot');

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const PORT            = process.env.PORT;

// Captura erros não tratados
process.on('unhandledRejection', (reason, p) => {
  console.error('🚨 Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', err => {
  console.error('🚨 Uncaught Exception:', err);
});

console.log('⚙️ Loaded ENV:', { N8N_WEBHOOK_URL });

// --- Servidor HTTP ---------------------------------------------------------

const app = express();

// Parse JSON apenas nos endpoints que realmente precisarem
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

// Logging genérico de todos os bodies POST recebidos
app.use((req, _res, next) => {
  if (req.method === 'POST' && req.body) {
    console.log('📥 RAW BODY:', JSON.stringify(req.body));
  }
  next();
});

// Health check
app.get('/', (_req, res) => res.status(200).send('OK'));

// Endpoint de envio de mensagem via API
async function sendHandler(req, res) {
  const isGet   = req.method === 'GET';
  const phone   = isGet ? req.query.phone   : req.body.phone;
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
    const errorMessage = err.message || JSON.stringify(err);
    return res.status(500).json({ success: false, error: errorMessage });
  }
}

app.get('/send', sendHandler);
app.post('/send', sendHandler);

// Inicia servidor HTTP
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

// --- Função de inicialização do Venom com LocalAuth + Health-Check --------

let healthInterval;

async function initVenom() {
  try {
    // limpa intervalo anterior
    if (healthInterval) {
      clearInterval(healthInterval);
      healthInterval = null;
    }

    const client = await venom.create({
      authStrategy: new LocalAuth({
        session: 'whatsapp-bot',
        dataPath: './sessions'
      }),
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
      ],
    });

    global.client = client;
    console.log('✅ Bot autenticado e pronto.');

    // Reconexão automática em caso de expiração ou desconexão de sessão
    client.onStateChange(state => {
      console.log(`StateChange: ${state}`);
      if (['CONFLICT','UNPAIRED','UNLAUNCHED','TIMEOUT','DISCONNECTED'].includes(state)) {
        console.warn('⚠️ Sessão inválida — reiniciando em 5s...');
        client.close();
        setTimeout(initVenom, 5000);
      }
    });

    // Health-check a cada 2 minutos
    healthInterval = setInterval(async () => {
      try {
        const ok = await client.isConnected();
        console.log('🔍 Health check, está conectado?', ok);
        if (!ok) {
          console.warn('❌ Cliente desconectado no health-check — reiniciando...');
          client.close();
          clearInterval(healthInterval);
          initVenom();
        }
      } catch (e) {
        console.error('❌ Erro no health-check:', e);
      }
    }, 2 * 60 * 1000);

    // Handler de mensagens: envia ao n8n
    client.onMessage(async message => {
      console.log(`🔔 Mensagem recebida de ${message.from}: "${message.body}"`);
      const payload = {
        telefone: message.from,
        mensagem: message.body || '',
        nome:     message.sender?.pushname || 'Desconhecido'
      };
      try {
        const res = await axios.post(N8N_WEBHOOK_URL, payload, { timeout: 5000 });
        console.log(`✅ Webhook chamado com status ${res.status}`);
      } catch (err) {
        console.error('❌ Erro ao chamar webhook:', err.message);
      }
    });

    // Debug opcional
    client.onStreamChange(stream => console.log('StreamChange:', stream));
    client.onAck(ack => console.log('Ack:', ack));

  } catch (err) {
    console.error('❌ InitVenom falhou:', err);
    setTimeout(initVenom, 10000);
  }
}

// Primeira inicialização
initVenom();
