const venom = require('venom-bot');
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

let client;

venom
  .create({ session: 'bot-session', headless: true })
  .then((c) => {
    client = c;
    startBot(c);
  })
  .catch((e) => console.error('❌ Erro ao iniciar o bot:', e));

function startBot(client) {
  client.onMessage(async (msg) => {
    if (msg.isGroupMsg || !msg.body) return;

    const data = {
      telefone: msg.from,
      mensagem: msg.body,
      nome: msg.sender?.pushname || ''
    };

    try {
      const response = await fetch('https://flowimoveis.app.n8n.cloud/webhook/fa8b2f28-34ef-4fbe-add6-446c64cf1fb2', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
      });

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

const app = express();
app.use(bodyParser.json());

app.post('/send', async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'Telefone e mensagem são obrigatórios.' });
  }

  try {
    await client.sendText(`${phone}@c.us`, message);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem via bot:', error);
    res.status(500).json({ success: false, error: error.toString() });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(` Servidor rodando na porta ${PORT}`);
});
