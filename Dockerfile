### Build stage: install tooling & build frontend
FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache openssl ca-certificates

# Copy package files and install ALL deps (including dev for build)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy sources and run build
COPY . .
RUN npm run build && \
    cp -v *.svg dist/ || true && \
    cp -v admin.html dist/ || true

### Production stage: use Debian for better compatibility with native modules
FROM node:22-bookworm-slim AS prod
WORKDIR /app

# Install runtime dependencies (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/*.svg ./
COPY --from=builder /app/jokes.db ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/admin.html ./admin.html
COPY --from=builder /app/exports ./exports
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/exports ./exports

# Generate cert
RUN mkdir -p /tmp && \
    openssl req -x509 -newkey rsa:2048 -keyout /tmp/key.pem -out /tmp/cert.pem -days 365 -nodes -subj "/CN=localhost" 2>/dev/null || true

EXPOSE 3000
CMD ["node", "server.js"]
