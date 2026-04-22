### Build stage: install tooling & build frontend
FROM node:22-bookworm AS builder
WORKDIR /app

# Install minimal apt deps required during build (openssl used to generate cert in final image)
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy package files and install dev deps (including vite)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy sources and run the frontend build
COPY . .
RUN npm run build

### Production stage: smaller image that serves built assets and runs the API
FROM node:22-bookworm AS prod
WORKDIR /app

# Install runtime deps only
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy server and built frontend from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/*.svg ./
COPY --from=builder /app/jokes.db ./

# Generate a self-signed cert used by server.js when no certs are provided
RUN mkdir -p /tmp && \
    openssl req -x509 -newkey rsa:2048 -keyout /tmp/key.pem -out /tmp/cert.pem -days 365 -nodes -subj "/CN=localhost" 2>/dev/null || true

EXPOSE 3000

CMD ["node", "server.js"]
