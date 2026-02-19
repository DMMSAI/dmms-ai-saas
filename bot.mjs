/**
 * DMMS AI — Telegram Bot (Long-Polling + Middleware Architecture)
 *
 * Architecture:
 *   Telegram → [Receive Middleware] → [AI Middleware] → [Send Middleware] → Telegram
 *
 * Each message flows through the middleware pipeline:
 *   1. Receive: Parse incoming Telegram message, normalize format
 *   2. Session: Get/create conversation, load history
 *   3. AI: Send to OpenAI with context, get response
 *   4. Store: Save both user message and AI response to DB
 *   5. Send: Deliver AI response back to Telegram
 */

import pg from "pg"
import OpenAI from "openai"
import { randomBytes } from "crypto"

const { Pool } = pg

// ── Config ───────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
const cuid = () => "c" + randomBytes(12).toString("hex")

let BOT_TOKEN = ""
const TG = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`

const SYSTEM_PROMPT = `You are DMMS AI, a smart and helpful AI assistant available on Telegram.

Rules:
- Answer the user's ACTUAL question. Read their message carefully.
- Be friendly, helpful, and concise.
- Keep responses under 400 characters when possible.
- Use plain text only — NO markdown, NO asterisks, NO code blocks.
- If the user greets you, greet them back warmly.
- If you don't know something, say so honestly.
- Each conversation is independent — focus on what the user is saying NOW.`

// ── Middleware Pipeline ──────────────────────────────────────────────

/**
 * The middleware pipeline processes each message through these steps:
 * 1. receiveMiddleware — Parse & normalize the incoming message
 * 2. sessionMiddleware — Load conversation context from DB
 * 3. aiMiddleware — Call OpenAI with the message + context
 * 4. storeMiddleware — Save user message + AI reply to DB
 * 5. sendMiddleware — Send the AI reply back to Telegram
 */

async function processMessage(msg) {
  const ctx = {}

  try {
    // Step 1: Receive — normalize the incoming message
    await receiveMiddleware(msg, ctx)

    // Step 2: Session — get conversation and history
    await sessionMiddleware(ctx)

    // Step 3: AI — generate response
    await aiMiddleware(ctx)

    // Step 4: Store — save messages to database
    await storeMiddleware(ctx)

    // Step 5: Send — reply to Telegram
    await sendMiddleware(ctx)

    console.log(`[Bot] ${ctx.userName}: "${ctx.text.slice(0, 40)}" → "${ctx.reply.slice(0, 40)}"`)
  } catch (err) {
    console.error("[Bot] Pipeline error:", err.message)
    // Try to send error message
    if (ctx.chatId) {
      await tgSend(ctx.chatId, "Sorry, something went wrong. Please try again.").catch(() => {})
    }
  }
}

// ── Step 1: Receive Middleware ───────────────────────────────────────

async function receiveMiddleware(msg, ctx) {
  ctx.chatId = String(msg.chat.id)
  ctx.text = (msg.text || "").trim()
  ctx.messageId = msg.message_id
  ctx.userName = msg.from?.first_name || "User"
  ctx.userId = null
  ctx.botToken = BOT_TOKEN

  if (!ctx.text) throw new Error("Empty message")
}

// ── Step 2: Session Middleware ───────────────────────────────────────

async function sessionMiddleware(ctx) {
  // Find the Telegram channel owner
  const channelRes = await pool.query(
    'SELECT "userId" FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
    ["telegram"]
  )
  if (channelRes.rows.length === 0) throw new Error("No Telegram channel configured")
  ctx.userId = channelRes.rows[0].userId

  // Get OpenAI API key
  const keyRes = await pool.query(
    'SELECT "apiKey" FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
    [ctx.userId, "openai"]
  )
  ctx.apiKey = keyRes.rows[0]?.apiKey || process.env.OPENAI_API_KEY
  if (!ctx.apiKey) throw new Error("No OpenAI API key configured")

  // Get or create conversation
  const convoRes = await pool.query(
    'SELECT id, "aiModel" FROM "Conversation" WHERE "userId" = $1 AND "channelType" = $2 AND "channelPeer" = $3 ORDER BY "updatedAt" DESC LIMIT 1',
    [ctx.userId, "telegram", ctx.chatId]
  )

  const now = new Date().toISOString()
  ctx.now = now

  if (convoRes.rows.length > 0) {
    ctx.convoId = convoRes.rows[0].id
    ctx.aiModel = convoRes.rows[0].aiModel || "gpt-4o-mini"
  } else {
    ctx.convoId = cuid()
    ctx.aiModel = "gpt-4o-mini"
    await pool.query(
      'INSERT INTO "Conversation" (id, "userId", "channelType", "channelPeer", title, "aiModel", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [ctx.convoId, ctx.userId, "telegram", ctx.chatId, ctx.text.slice(0, 50), ctx.aiModel, now, now]
    )
  }

  // Load recent history (last 15 messages for context)
  const historyRes = await pool.query(
    'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" DESC LIMIT 15',
    [ctx.convoId]
  )
  // Reverse to chronological order
  ctx.history = historyRes.rows.reverse()
}

// ── Step 3: AI Middleware ────────────────────────────────────────────

async function aiMiddleware(ctx) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...ctx.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: ctx.text },
  ]

  const openai = new OpenAI({ apiKey: ctx.apiKey })
  const completion = await openai.chat.completions.create({
    model: ctx.aiModel,
    messages,
    temperature: 0.7,
    max_tokens: 1024,
  })

  ctx.reply = completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response."
}

// ── Step 4: Store Middleware ─────────────────────────────────────────

async function storeMiddleware(ctx) {
  const saveNow = new Date().toISOString()

  // Save user message
  await pool.query(
    'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
    [cuid(), ctx.convoId, "user", ctx.text, ctx.now]
  )

  // Save AI response
  await pool.query(
    'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
    [cuid(), ctx.convoId, "assistant", ctx.reply, saveNow]
  )

  // Update conversation timestamp
  await pool.query('UPDATE "Conversation" SET "updatedAt" = $1 WHERE id = $2', [saveNow, ctx.convoId])
}

// ── Step 5: Send Middleware ──────────────────────────────────────────

async function sendMiddleware(ctx) {
  await tgSend(ctx.chatId, ctx.reply, ctx.messageId)
}

// ── Telegram Helpers ─────────────────────────────────────────────────

async function tgSend(chatId, text, replyToId) {
  // Split long messages (Telegram limit: 4096 chars)
  const chunks = []
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.slice(i, i + 4000))
  }

  for (let i = 0; i < chunks.length; i++) {
    const body = { chat_id: chatId, text: chunks[i] }
    if (replyToId && i === 0) {
      body.reply_parameters = { message_id: replyToId, allow_sending_without_reply: true }
    }

    const res = await fetch(TG("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      console.error("[Bot] Send failed:", data.description)
      // Retry without reply
      if (replyToId && i === 0) {
        await fetch(TG("sendMessage"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunks[i] }),
        })
      }
    }
  }
}

async function tgTyping(chatId) {
  fetch(TG("sendChatAction"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  }).catch(() => {})
}

// ── Long-Polling Loop ────────────────────────────────────────────────

async function pollLoop(offset) {
  while (true) {
    try {
      const url = `${TG("getUpdates")}?offset=${offset}&timeout=25&allowed_updates=${encodeURIComponent('["message","edited_message"]')}`
      const res = await fetch(url, { signal: AbortSignal.timeout(35000) })
      const data = await res.json()

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1
          const msg = update.message || update.edited_message
          if (!msg?.text) continue

          // Handle /start command
          if (msg.text === "/start") {
            await tgSend(String(msg.chat.id), "Welcome to DMMS AI! Send me any message and I'll respond with AI.\n\nPowered by DMMS AI — Every Messenger is AI Now.")
            continue
          }

          // Handle /new command (reset conversation)
          if (msg.text === "/new") {
            await tgSend(String(msg.chat.id), "Conversation reset! Send me a new message.")
            continue
          }

          // Show typing indicator then process
          tgTyping(String(msg.chat.id))
          await processMessage(msg)
        }
      }
    } catch (err) {
      if (err.name !== "AbortError" && err.name !== "TimeoutError") {
        console.error("[Bot] Poll error:", err.message)
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("[Bot] DMMS AI Telegram Bot starting...")

  // Resolve bot token
  BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
  if (!BOT_TOKEN) {
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
      console.error("[Bot] DB error:", err.message)
    }
  }

  if (!BOT_TOKEN) {
    console.error("[Bot] No bot token! Set TELEGRAM_BOT_TOKEN env var or configure in dashboard.")
    process.exit(1)
  }

  // Delete any webhook (can't use both webhook and polling)
  await fetch(TG("deleteWebhook"), { method: "POST" }).catch(() => {})

  // Verify bot connection
  const me = await fetch(TG("getMe"))
  const meData = await me.json()
  if (!meData.ok) {
    console.error("[Bot] Invalid token:", meData.description)
    process.exit(1)
  }

  console.log(`[Bot] Connected as @${meData.result.username}`)
  console.log("[Bot] Middleware pipeline: Receive → Session → AI → Store → Send")
  console.log("[Bot] Waiting for messages...")

  await pollLoop(0)
}

main().catch((err) => {
  console.error("[Bot] Fatal:", err)
  process.exit(1)
})
