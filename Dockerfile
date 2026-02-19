FROM node:22-alpine AS base

# ── Build stage ──────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install production deps (needed by bot.mjs: baileys, discord.js, pg, openai, etc.)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy standalone server
COPY --from=builder /app/.next/standalone ./
# Copy static files
COPY --from=builder /app/.next/static ./.next/static
# Copy public assets
COPY --from=builder /app/public ./public
# Copy Baileys auth adapter (used by bot.mjs)
COPY --from=builder /app/lib/baileys-auth-pg.mjs ./lib/baileys-auth-pg.mjs

EXPOSE 3000

# Start bot gateway (background) + Next.js standalone server (foreground)
CMD ["sh", "-c", "node bot.mjs & node server.js"]
