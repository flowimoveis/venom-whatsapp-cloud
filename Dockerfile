# Use uma imagem leve do Node.js
FROM node:22.14.0-slim


# Instala o Chromium via apt (muito mais rápido que o download do Puppeteer)
RUN apt-get update && \
    apt-get install -y chromium && \
    rm -rf /var/lib/apt/lists/*

# Define o diretório de trabalho
WORKDIR /app

# Copia apenas os manifests para acelerar cache de dependências
COPY package*.json ./

# Instala as dependências sem as opcionais (pula o sleep etc.)
RUN npm install --no-optional

# Copia o restante do código da aplicação
COPY . .

# Fala pro Puppeteer/Venom não baixar o Chromium novamente
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expõe a porta que o Express vai ouvir
EXPOSE 3000

# Comando de inicialização
CMD ["node", "index.js"]
