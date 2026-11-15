# syntax=docker/dockerfile:1
# -----------------------------------------------------------------------------
# VoxPulse SIP Platform - Production Dockerfile for Dokploy / Docker Deployments
# -----------------------------------------------------------------------------

# Stage 1: Build the client assets & self-contained production bundle
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Copy all source files
COPY . .

# Build Vite frontend + generate embedded dist + bundle standalone production server
RUN npm run build

# Stage 2: Minimal & secure production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install curl for Docker/Dokploy HTTP healthchecks
RUN apk add --no-cache curl

# Create non-root system user for security
RUN addgroup -S -g 1001 voxpulse && \
    adduser -S -u 1001 -G voxpulse voxpulse

# Copy built artifacts and assets from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/passenger-server.cjs ./
COPY --from=builder /app/app.js ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/firebase-cloud-state.json ./
COPY --from=builder /app/firebase-applet-config.json ./
COPY --from=builder /app/firestore.rules ./

# Create data directory with appropriate ownership
RUN mkdir -p /app/data && chown -R voxpulse:voxpulse /app

USER voxpulse

EXPOSE 3000

# Dokploy & Traefik Healthcheck
HEALTHCHECK --interval=20s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the self-contained production server
CMD ["node", "server.js"]
