FROM node:22-alpine AS base

# ── Build stage ──────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Alpine needs git + build tools for native deps (libsignal, sharp)
RUN apk add --no-cache git python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Prune dev dependencies ───────────────────────────────────────────
RUN npm prune --omit=dev

# ── Production stage ─────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy standalone server
COPY --from=builder /app/.next/standalone ./
# Copy static files
COPY --from=builder /app/.next/static ./.next/static
# Copy public assets
COPY --from=builder /app/public ./public
# Copy production node_modules (for bot.mjs deps: baileys, discord.js, pg, etc.)
COPY --from=builder /app/node_modules ./node_modules
# Copy Baileys auth adapter
COPY --from=builder /app/lib/baileys-auth-pg.mjs ./lib/baileys-auth-pg.mjs

EXPOSE 3000

# Start bot gateway (background) + Next.js standalone server (foreground)
CMD ["sh", "-c", "node bot.mjs & node server.js"]
