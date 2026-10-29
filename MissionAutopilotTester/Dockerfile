# =============================================================================
# Mission Autopilot Tester — Production Docker Image
#
# Standalone single-file React app for exercising any action-server REST
# implementation. Multi-stage build: bundle the single-file
# app with Vite, then serve the static output with nginx.
#
# Prerequisites:
#   - Docker (Engine or Desktop)
#
# Quick Start:
#   docker compose up --build -d
#   Open http://localhost:3004
#
# Manual Build & Run:
#   docker build -t mission-autopilot-tester .
#   docker run -d -p 3004:80 mission-autopilot-tester
#
# This app has NO backend. In the UI, enter the URL of your Action Container
# (e.g. http://localhost:3002); the container's CORS policy allows it.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build the single-file app
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies (cached unless package files change)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build → dist/index.html (all JS/CSS inlined into one file)
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Serve with nginx
# ---------------------------------------------------------------------------
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA routing: serve index.html for any path
RUN printf 'server {\n\
    listen 80;\n\
    server_name localhost;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1
