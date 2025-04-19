const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const venom = require('venom-bot');

const app = express();
// 1️⃣ Middleware de logging do corpo bruto
app.use((req, res, next) => {
  let raw = '';
  req.on('data', chunk => raw += chunk);
  req.on('end', () => {
    if (raw) console.log('📥 RAW BODY:', raw);
    next();
  });
});
// 2️⃣ Middleware de parsing padrão
// Substitua o bodyParser padrão por este bloco
app.use(bodyParser.json({
  strict: true,
  verify: (req, _res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      console.error('❌ JSON inválido recebido:', buf.toString());
      throw e;
    }
  }
}));

// Handler de erro para JSON mal‑formado
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'JSON inválido' });
  }
  next(err);
});


// Evita erro 502 no favicon (Apenas uma vez!)
app.get('/favicon.ico', (req, res) => res.sendStatus(204));

// Health check
app.get('/', (req, res) => res.status(200).send('OK'));

let client;

// Envio de mensagens via HTTP
app.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res
      .status(400)
      .json({ success: false, error: 'Telefone e mensagem são obrigatórios.' });
  }
  try {
    await client.sendText(`${phone}@c.us`, message);
    return res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem via bot:', error);
    return res.status(500).json({ success: false, error: error.toString() });
  }
});

// Inicia o servidor HTTP
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Inicia o Venom‑bot
venom.create({
  session: '/app/tokens/bot-session',
  headless: true,
  useChrome: true
})
.then(c => {
  client = c;
  console.log('✅ Bot autenticado e pronto.');
  startBotListeners(c);
})
.catch(e => {
  console.error('❌ Erro ao iniciar o bot:', e);
  process.exit(1);
});


function startBotListeners(client) {
  client.onMessage(async (msg) => {
    if (msg.isGroupMsg || !msg.body) return;
    const data = {
      telefone: msg.from,
      mensagem: msg.body,
      nome: msg.sender?.pushname || ''
    };
    try {
      const response = await fetch(
        'https://flowimoveis.app.n8n.cloud/webhook/fa8b2f28-34ef-4fbe-add6-446c64cf1fb2',
        {
          method: 'POST',
          body: JSON.stringify(data),
          headers: { 'Content-Type': 'application/json' }
        }
      );
      if (!response.ok) {
        console.error('❌ Erro ao enviar dados para o n8n:', await response.text());
      } else {
        console.log('✅ Dados enviados para o n8n com sucesso.');
      }
    } catch (error) {
      console.error('❌ Falha ao enviar mensagem para o n8n:', error);
    }
  });
}
