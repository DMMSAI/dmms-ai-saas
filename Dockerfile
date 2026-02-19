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

# Copy everything needed for production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bot.mjs ./

EXPOSE 3000

# Start bot (background) + Next.js (foreground)
CMD ["sh", "-c", "node bot.mjs & npx next start -p ${PORT:-3000}"]
