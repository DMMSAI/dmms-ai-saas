/**
 * DMMS AI — Multi-Channel Gateway v4.0
 * 3-Layer Architecture: Connector + Middleware + AI
 *
 * Pipeline: Connector → Session → History → AI Router → Store → Reply
 *
 * This file is a thin orchestrator (~80 lines) that wires together:
 *   - lib/middleware/  — Composable pipeline steps
 *   - lib/ai/         — AI providers (OpenAI, Gemini)
 *   - lib/connectors/ — Platform connectors (Telegram, WhatsApp, Discord, Slack)
 */

import pg from "pg"
import { createPipeline } from "./lib/middleware/pipeline.mjs"
import { sessionMiddleware } from "./lib/middleware/session.mjs"
import { historyMiddleware } from "./lib/middleware/history.mjs"
import { aiRouterMiddleware } from "./lib/middleware/ai-router.mjs"
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
  sessionMiddleware(pool),
  historyMiddleware(pool),
  aiRouterMiddleware(pool),
  storeMiddleware(pool),
])

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗")
  console.log("║  DMMS AI — Multi-Channel Gateway v4.0               ║")
  console.log("║  3-Layer Architecture: Connector + Middleware + AI   ║")
  console.log("║  Every Messenger is AI Now.                          ║")
  console.log("╚══════════════════════════════════════════════════════╝")
  console.log(`[Gateway] Tools: ${TOOLS.map((t) => t.definition.function.name).join(", ")}`)
  console.log(`[Gateway] AI Providers: OpenAI, Gemini`)

  await ensureTables()

  // Create connector registry and sync from DB
  const registry = new ConnectorRegistry(pool, pipeline)

  console.log("[Gateway] Starting connectors from DB...")
  await registry.syncFromDB()

  // Start polling for new channel activations
  registry.pollForChanges(5000)

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
