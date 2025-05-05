module.exports = {
  apps: [
    {
      name: 'whatsapp-bot',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      cron_restart: '0 */6 * * *', // reinicia a cada 6h
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        N8N_WEBHOOK_URL: 'https://flowimoveis.app.n8n.cloud/webhook/bbb55806-96cf-40ab-b010-cda8d3422c34'
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true // adiciona timestamp nos logs
    }
  ]
};
