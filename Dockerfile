# Dockerfile
FROM node:22.14.0‑slim

# Instala o Chromium do sistema (bem mais rápido que o download do Puppeteer)
RUN apt-get update && apt-get install -y chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia só o package.json e package‑lock (se tiver)
COPY package*.json ./

# Instala pacotes sem dependências opcionais
RUN npm install --no-optional

# Copia o restante do código
COPY . .

# Informa onde está o executable do Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3000

# Comando de start
CMD ["node", "index.js"]
