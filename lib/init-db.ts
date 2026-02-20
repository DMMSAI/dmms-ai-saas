import { Pool } from "pg"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"

function cuid() {
  return "c" + randomBytes(12).toString("hex")
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS "User" (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  name TEXT,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "UserChannel" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "channelType" TEXT NOT NULL,
  "connectionMode" TEXT DEFAULT 'business',
  config TEXT DEFAULT '{}',
  enabled BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'disconnected',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE("userId", "channelType", "connectionMode")
);

CREATE TABLE IF NOT EXISTS "UserApiKey" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  "apiKey" TEXT NOT NULL,
  "isDefault" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE("userId", provider)
);

CREATE TABLE IF NOT EXISTS "Conversation" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "channelType" TEXT NOT NULL DEFAULT 'web',
  "channelPeer" TEXT DEFAULT '',
  title TEXT DEFAULT 'New Chat',
  "aiModel" TEXT DEFAULT 'gpt-4o',
  "aiProvider" TEXT DEFAULT 'openai',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Message" (
  id TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL REFERENCES "Conversation"(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments JSONB,
  "toolCalls" JSONB,
  "tokenCount" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE INDEX IF NOT EXISTS idx_conversation_user ON "Conversation"("userId");
CREATE INDEX IF NOT EXISTS idx_message_conversation ON "Message"("conversationId");
CREATE INDEX IF NOT EXISTS idx_userchannel_user ON "UserChannel"("userId");
CREATE INDEX IF NOT EXISTS idx_userapikey_user ON "UserApiKey"("userId");
`

const MIGRATIONS = `
-- Migration: Add connectionMode to UserChannel (safe for existing DBs)
ALTER TABLE "UserChannel" ADD COLUMN IF NOT EXISTS "connectionMode" TEXT DEFAULT 'business';
DO $$ BEGIN
  ALTER TABLE "UserChannel" DROP CONSTRAINT IF EXISTS "UserChannel_userId_channelType_key";
  ALTER TABLE "UserChannel" ADD CONSTRAINT "UserChannel_userId_channelType_connectionMode_key"
    UNIQUE("userId", "channelType", "connectionMode");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Migration: Add aiProvider to Conversation
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiProvider" TEXT DEFAULT 'openai';
`

async function initDb() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error("DATABASE_URL not set")
    process.exit(1)
  }

  const pool = new Pool({ connectionString: dbUrl })

  console.log("Creating tables...")
  await pool.query(SCHEMA)
  console.log("Tables created.")

  console.log("Running migrations...")
  await pool.query(MIGRATIONS)
  console.log("Migrations applied.")

  // Seed admin user if not exists
  const existing = await pool.query('SELECT id FROM "User" WHERE email = $1', ["admin@admin.com"])
  if (existing.rows.length === 0) {
    const hashed = await bcrypt.hash("Admin@2020", 12)
    const id = cuid()
    const now = new Date().toISOString()
    await pool.query(
      'INSERT INTO "User" (id, email, password, name, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [id, "admin@admin.com", hashed, "Admin", now, now]
    )
    console.log("Admin user created: admin@admin.com / Admin@2020")
  } else {
    console.log("Admin user already exists.")
  }

  await pool.end()
  console.log("Database initialized successfully!")
}

initDb().catch(console.error)
