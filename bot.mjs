/**
 * DMMS AI — Standalone Telegram Bot (Long-Polling)
 *
 * Runs as a separate process alongside Next.js.
 * Uses getUpdates (long-polling) — same approach as Cloudbot.
 */

import pg from "pg"
import OpenAI from "openai"
import { randomBytes } from "crypto"

const { Pool } = pg

// ── Config ───────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
})

function cuid() {
  return "c" + randomBytes(12).toString("hex")
}

const TG = (method) =>
  `https://api.telegram.org/bot${BOT_TOKEN}/${method}`

let BOT_TOKEN = ""

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("[TG Bot] Starting...")

  // Resolve bot token
  BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""

  if (!BOT_TOKEN) {
    // Try database
    try {
      const res = await pool.query(
        'SELECT config FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
        ["telegram"]
      )
      if (res.rows.length > 0) {
        const raw = res.rows[0].config
        const config = typeof raw === "string" ? JSON.parse(raw) : raw
        if (config?.botToken) BOT_TOKEN = config.botToken
      }
    } catch (err) {
      console.error("[TG Bot] DB error:", err.message)
    }
  }

  if (!BOT_TOKEN) {
    console.error("[TG Bot] No bot token found! Set TELEGRAM_BOT_TOKEN or configure in dashboard.")
    console.log("[TG Bot] Retrying in 30s...")
    setTimeout(main, 30000)
    return
  }

  // Delete any webhook (can't use both)
  try {
    await fetch(TG("deleteWebhook"), { method: "POST" })
  } catch {}

  // Verify bot
  try {
    const res = await fetch(TG("getMe"))
    const data = await res.json()
    if (data.ok) {
      console.log(`[TG Bot] Connected as @${data.result.username} (${data.result.first_name})`)
    } else {
      console.error("[TG Bot] Invalid token:", data.description)
      process.exit(1)
    }
  } catch (err) {
    console.error("[TG Bot] Connection failed:", err.message)
    setTimeout(main, 10000)
    return
  }

  // Start polling
  console.log("[TG Bot] Long-polling started. Waiting for messages...")
  await pollLoop(0)
}

// ── Long-Polling Loop ────────────────────────────────────────────────

async function pollLoop(offset) {
  while (true) {
    try {
      const url = `${TG("getUpdates")}?offset=${offset}&timeout=25&allowed_updates=${encodeURIComponent('["message","edited_message"]')}`

      const res = await fetch(url, {
        signal: AbortSignal.timeout(35000),
      })

      const data = await res.json()

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1
          const msg = update.message || update.edited_message
          if (msg?.text) {
            try {
              await handleMessage(msg)
            } catch (err) {
              console.error("[TG Bot] Handler error:", err.message)
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError" && err.name !== "TimeoutError") {
        console.error("[TG Bot] Poll error:", err.message)
      }
      await sleep(3000)
    }
  }
}

// ── Message Handler ──────────────────────────────────────────────────

async function handleMessage(msg) {
  const chatId = String(msg.chat.id)
  const text = msg.text || ""
  if (!text) return

  console.log(`[TG Bot] << ${msg.from.first_name}: ${text.slice(0, 60)}`)

  // /start
  if (text === "/start") {
    await sendTg(chatId, "Welcome to DMMS AI! Send me any message and I'll respond with AI.")
    return
  }

  // Typing indicator
  fetch(TG("sendChatAction"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  }).catch(() => {})

  // Find channel owner
  const channelRes = await pool.query(
    'SELECT * FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
    ["telegram"]
  )
  if (channelRes.rows.length === 0) {
    await sendTg(chatId, "Bot not configured. Set up Telegram in the DMMS AI dashboard.")
    return
  }
  const userId = channelRes.rows[0].userId

  // Get OpenAI key
  const keyRes = await pool.query(
    'SELECT "apiKey" FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
    [userId, "openai"]
  )
  const apiKey = keyRes.rows[0]?.apiKey || process.env.OPENAI_API_KEY
  if (!apiKey) {
    await sendTg(chatId, "No OpenAI API key. Add one in Settings on the DMMS AI dashboard.")
    return
  }

  // Get or create conversation
  const convoRes = await pool.query(
    'SELECT id, "aiModel" FROM "Conversation" WHERE "userId" = $1 AND "channelType" = $2 AND "channelPeer" = $3 ORDER BY "updatedAt" DESC LIMIT 1',
    [userId, "telegram", chatId]
  )

  let convoId, aiModel
  const now = new Date().toISOString()

  if (convoRes.rows.length > 0) {
    convoId = convoRes.rows[0].id
    aiModel = convoRes.rows[0].aiModel || "gpt-4o-mini"
  } else {
    convoId = cuid()
    aiModel = "gpt-4o-mini"
    await pool.query(
      'INSERT INTO "Conversation" (id, "userId", "channelType", "channelPeer", title, "aiModel", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [convoId, userId, "telegram", chatId, text.slice(0, 50), aiModel, now, now]
    )
  }

  // Save user message
  await pool.query(
    'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
    [cuid(), convoId, "user", text, now]
  )

  // Build context
  const historyRes = await pool.query(
    'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" ASC LIMIT 20',
    [convoId]
  )

  const messages = [
    {
      role: "system",
      content:
        "You are DMMS AI, a helpful AI assistant on Telegram. Be knowledgeable, friendly, and concise. Keep responses under 500 characters when possible. Use plain text only — no markdown.",
    },
    ...historyRes.rows.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ]

  // Call OpenAI
  const openai = new OpenAI({ apiKey })
  const completion = await openai.chat.completions.create({
    model: aiModel,
    messages,
    temperature: 0.7,
    max_tokens: 1024,
  })

  const reply =
    completion.choices[0]?.message?.content ||
    "Sorry, I couldn't generate a response."

  // Save reply
  const saveNow = new Date().toISOString()
  await pool.query(
    'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
    [cuid(), convoId, "assistant", reply, saveNow]
  )
  await pool.query('UPDATE "Conversation" SET "updatedAt" = $1 WHERE id = $2', [
    saveNow,
    convoId,
  ])

  // Send reply
  await sendTg(chatId, reply, msg.message_id)
  console.log(`[TG Bot] >> ${reply.slice(0, 60)}`)
}

// ── Telegram Send ────────────────────────────────────────────────────

async function sendTg(chatId, text, replyToId) {
  const chunks = []
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.slice(i, i + 4000))
  }

  for (let i = 0; i < chunks.length; i++) {
    const body = { chat_id: chatId, text: chunks[i] }

    if (replyToId && i === 0) {
      body.reply_parameters = {
        message_id: replyToId,
        allow_sending_without_reply: true,
      }
    }

    try {
      const res = await fetch(TG("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.ok) {
        console.error("[TG Bot] Send failed:", data.description)
        // Retry without reply
        if (replyToId && i === 0) {
          await fetch(TG("sendMessage"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: chunks[i] }),
          })
        }
      }
    } catch (err) {
      console.error("[TG Bot] Send error:", err.message)
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Start ────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error("[TG Bot] Fatal:", err)
  process.exit(1)
})
