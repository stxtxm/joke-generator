FROM node:22-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /tmp && \
    openssl req -x509 -newkey rsa:2048 -keyout /tmp/key.pem -out /tmp/cert.pem -days 365 -nodes -subj "/CN=localhost" 2>/dev/null

EXPOSE 3000

CMD ["node", "server.js"]