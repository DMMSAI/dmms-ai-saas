/**
 * DMMS AI — Multi-Channel Gateway v4.0
 * 3-Layer Architecture: Connector + Middleware + AI
 *
 * Pipeline (11 steps):
 *   metering → session → history → envelope → enrichment →
 *   persona → news → aiRouter → formatter → footer → store
 *
 * This file is a thin orchestrator that wires together:
 *   - lib/middleware/  — Composable pipeline steps
 *   - lib/ai/         — AI providers (OpenAI, Gemini)
 *   - lib/connectors/ — Platform connectors (Telegram, WhatsApp, Discord, Slack)
 */

import pg from "pg"
import { createPipeline } from "./lib/middleware/pipeline.mjs"
import { meteringMiddleware } from "./lib/middleware/metering.mjs"
import { sessionMiddleware } from "./lib/middleware/session.mjs"
import { historyMiddleware } from "./lib/middleware/history.mjs"
import { envelopeMiddleware } from "./lib/middleware/envelope.mjs"
import { enrichmentMiddleware } from "./lib/middleware/enrichment.mjs"
import { personaMiddleware } from "./lib/middleware/persona.mjs"
import { newsMiddleware } from "./lib/middleware/news.mjs"
import { aiRouterMiddleware } from "./lib/middleware/ai-router.mjs"
import { formatterMiddleware } from "./lib/middleware/formatter.mjs"
import { footerMiddleware } from "./lib/middleware/footer.mjs"
import { storeMiddleware } from "./lib/middleware/store.mjs"
import { ConnectorRegistry } from "./lib/connectors/registry.mjs"
import { TOOLS } from "./lib/ai/tools.mjs"

const { Pool } = pg

// ── Database ────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

// ── Ensure Tables ───────────────────────────────────────────────────

async function ensureTables() {
  console.log("[Gateway] Ensuring database tables exist...")
  await pool.query(`
    CREATE TABLE IF NOT EXISTS baileys_auth (
      id         TEXT NOT NULL,
      user_id    TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      data       JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, id)
    );
    CREATE TABLE IF NOT EXISTS channel_events (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      channel_type TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      payload      TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_channel_events_user ON channel_events(user_id, channel_type, event_type);

    -- Migrations: safe column additions for existing DBs
    ALTER TABLE "UserChannel" ADD COLUMN IF NOT EXISTS "connectionMode" TEXT DEFAULT 'business';
    ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiProvider" TEXT DEFAULT 'openai';
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "defaultAiProvider" TEXT DEFAULT 'openai';
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "defaultAiModel" TEXT DEFAULT 'gpt-4o';

    -- Migration: update unique constraint to include connectionMode
    DO $$ BEGIN
      ALTER TABLE "UserChannel" DROP CONSTRAINT IF EXISTS "UserChannel_userId_channelType_key";
      ALTER TABLE "UserChannel" ADD CONSTRAINT "UserChannel_userId_channelType_connectionMode_key"
        UNIQUE("userId", "channelType", "connectionMode");
    EXCEPTION WHEN duplicate_table THEN NULL;
    END $$;
  `)
  console.log("[Gateway] Database tables ready.")
}

// ── Build Middleware Pipeline ────────────────────────────────────────

const pipeline = createPipeline([
  meteringMiddleware(pool),       //  1. Rate limiting (short-circuits if over limit)
  sessionMiddleware(pool),        //  2. Look up / create conversation
  historyMiddleware(pool),        //  3. Load last 10 messages
  envelopeMiddleware(),           //  4. Wrap message with metadata
  enrichmentMiddleware(),         //  5. Fetch URL content if links present
  personaMiddleware(),            //  6. Build rich system prompt
  newsMiddleware(),               //  7. Smart news pre-fetch
  aiRouterMiddleware(pool),       //  8. Call AI provider
  formatterMiddleware(),          //  9. Platform-specific formatting
  footerMiddleware(),             // 10. Model prefix + footer (defaults: off)
  storeMiddleware(pool),          // 11. Save to database
])

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗")
  console.log("║  DMMS AI — Multi-Channel Gateway v4.0               ║")
  console.log("║  11-Step Middleware Pipeline                         ║")
  console.log("║  Every Messenger is AI Now.                          ║")
  console.log("╚══════════════════════════════════════════════════════╝")
  console.log(`[Gateway] Tools: ${TOOLS.map((t) => t.definition.function.name).join(", ")}`)
  console.log(`[Gateway] AI Providers: OpenAI, Gemini, Anthropic (Claude)`)
  console.log(`[Gateway] Pipeline: metering → session → history → envelope → enrichment → persona → news → aiRouter → formatter → footer → store`)

  await ensureTables()

  // Create connector registry and sync from DB
  const registry = new ConnectorRegistry(pool, pipeline)

  console.log("[Gateway] Starting connectors from DB...")
  await registry.syncFromDB()

  // Start polling for new channel activations
  registry.pollForChanges(2000)

  console.log("[Gateway] All connectors initialized. Waiting for messages...")

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Gateway] ${signal} received, shutting down...`)
    await registry.stopAll()
    await pool.end()
    process.exit(0)
  }

  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}

main().catch((err) => {
  console.error("[Gateway] Fatal:", err)
  process.exit(1)
})
