/**
 * DMMS AI — Multi-Channel Gateway v3.0
 * Unified AI Gateway: Telegram + WhatsApp (Baileys QR) + Discord
 *
 * Pipeline (shared across all channels):
 *   Channel → Receive → Session → Context → AI (+ Tools) → Store → Send → Channel
 *
 * Channels:
 *   - Telegram: Long-polling via Telegram Bot API
 *   - WhatsApp: QR code scanning via Baileys (WhatsApp Web protocol)
 *   - Discord: discord.js client with message intents
 */

import pg from "pg"
import OpenAI from "openai"
import { randomBytes } from "crypto"
import { makeWASocket, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys"
import { Boom } from "@hapi/boom"
import { Client, GatewayIntentBits } from "discord.js"
import { usePgAuthState } from "./lib/baileys-auth-pg.mjs"

const { Pool } = pg

// ── Config ───────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
const cuid = () => "c" + randomBytes(12).toString("hex")

// ── Tools Registry (Extensible) ─────────────────────────────────────

const TOOLS = []

// Tool 1: Web Search
TOOLS.push({
  definition: {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the internet for current/real-time information including weather, news, prices, sports scores, events, people, places, or any factual question. Use this whenever the user asks about something that might need up-to-date information.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to look up on the internet",
          },
        },
        required: ["query"],
      },
    },
  },
  execute: webSearch,
})

// Tool 2: Get Date/Time
TOOLS.push({
  definition: {
    type: "function",
    function: {
      name: "get_datetime",
      description: "Get the current date, time, and day of the week.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  execute: async () => {
    const now = new Date()
    return JSON.stringify({
      date: now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      time: now.toLocaleTimeString("en-US", { hour12: true }),
      timezone: "UTC",
      iso: now.toISOString(),
    })
  },
})

// ── Web Search Implementation ────────────────────────────────────────

async function webSearch(args) {
  const query = args.query
  console.log(`[MW:Search] Searching: "${query}"`)

  try {
    const res = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "DMMS-AI/3.0",
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(8000),
    })

    const html = await res.text()
    const results = []

    const snippetRegex =
      /<td\s+class=['"]result-snippet['"]>([\s\S]*?)<\/td>/gi
    const linkRegex =
      /<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi

    const snippets = []
    const titles = []
    let m

    while ((m = snippetRegex.exec(html)) !== null && snippets.length < 5) {
      snippets.push(
        m[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/\s+/g, " ")
          .trim()
      )
    }

    while ((m = linkRegex.exec(html)) !== null && titles.length < 5) {
      titles.push(
        m[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim()
      )
    }

    for (let i = 0; i < Math.max(snippets.length, titles.length); i++) {
      results.push({
        title: titles[i] || "",
        snippet: snippets[i] || "",
      })
    }

    if (results.length === 0) {
      const iaRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`,
        { signal: AbortSignal.timeout(5000) }
      )
      const iaData = await iaRes.json()

      if (iaData.AbstractText) {
        results.push({ title: iaData.Heading || query, snippet: iaData.AbstractText })
      }
      if (iaData.Answer) {
        results.push({ title: "Answer", snippet: iaData.Answer })
      }
      if (iaData.RelatedTopics && results.length === 0) {
        for (const topic of iaData.RelatedTopics.slice(0, 3)) {
          if (topic.Text) {
            results.push({ title: topic.FirstURL || "", snippet: topic.Text })
          }
        }
      }
    }

    if (results.length === 0) {
      return `No search results found for: "${query}". Please answer based on your knowledge.`
    }

    const formatted = results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
      .join("\n\n")

    console.log(`[MW:Search] Found ${results.length} results`)
    return `Web search results for "${query}":\n\n${formatted}\n\nUse these results to give the user an accurate, up-to-date answer.`
  } catch (err) {
    console.error(`[MW:Search] Error:`, err.message)
    return `Web search failed (${err.message}). Please answer based on your knowledge and let the user know the information might not be fully current.`
  }
}

// ── System Prompt ────────────────────────────────────────────────────

function buildSystemPrompt(channelName = "Messenger") {
  const now = new Date()
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const timeStr = now.toLocaleTimeString("en-US", { hour12: true })

  return `You are DMMS AI, an intelligent AI assistant on ${channelName}. Today is ${dateStr}, ${timeStr} UTC.

CAPABILITIES:
- You can search the internet for real-time information (weather, news, prices, events, etc.)
- You have access to tools: use web_search when you need current/live data
- You remember the conversation context

RULES:
- Read the user's message carefully and answer their EXACT question
- When asked about weather, news, prices, sports, or current events: ALWAYS use the web_search tool first
- Be helpful, accurate, and direct
- Keep responses concise but complete (under 500 characters when possible)
- Use plain text — no markdown formatting, no asterisks, no code blocks
- If the user greets you, greet them warmly and ask how you can help
- If a tool search fails, be honest about it
- Be conversational and natural, like a smart friend

IDENTITY:
- You are DMMS AI, NOT ChatGPT, NOT Google, NOT Siri
- You are powered by advanced AI technology
- You are available on multiple messengers (Telegram, WhatsApp, Discord, and more)
- Your tagline: "Every Messenger is AI Now"`
}

// ══════════════════════════════════════════════════════════════════════
// SHARED MIDDLEWARE PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Shared middleware: Get or create conversation, load history
 * @param {object} ctx - Must have: userId, channelType, channelPeer, text
 */
async function getOrCreateConvo(ctx) {
  const convoRes = await pool.query(
    'SELECT id, "aiModel" FROM "Conversation" WHERE "userId" = $1 AND "channelType" = $2 AND "channelPeer" = $3 ORDER BY "updatedAt" DESC LIMIT 1',
    [ctx.userId, ctx.channelType, ctx.channelPeer]
  )

  ctx.now = new Date().toISOString()

  if (convoRes.rows.length > 0) {
    ctx.convoId = convoRes.rows[0].id
    ctx.aiModel = convoRes.rows[0].aiModel || "gpt-4o-mini"
  } else {
    ctx.convoId = cuid()
    ctx.aiModel = "gpt-4o-mini"
    await pool.query(
      'INSERT INTO "Conversation" (id, "userId", "channelType", "channelPeer", title, "aiModel", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [ctx.convoId, ctx.userId, ctx.channelType, ctx.channelPeer, ctx.text.slice(0, 50), ctx.aiModel, ctx.now, ctx.now]
    )
  }
}

async function loadHistory(ctx) {
  const historyRes = await pool.query(
    'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" DESC LIMIT 10',
    [ctx.convoId]
  )
  ctx.history = historyRes.rows.reverse()
}

async function callAI(ctx) {
  // Get OpenAI API key
  const keyRes = await pool.query(
    'SELECT "apiKey" FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
    [ctx.userId, "openai"]
  )
  const apiKey = keyRes.rows[0]?.apiKey || process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("No OpenAI API key configured")

  const openai = new OpenAI({ apiKey })

  const messages = [
    { role: "system", content: buildSystemPrompt(ctx.channelName || ctx.channelType) },
    ...ctx.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: ctx.text },
  ]

  const tools = TOOLS.map((t) => t.definition)
  let maxRounds = 3
  let round = 0
  ctx.toolsUsed = ctx.toolsUsed || []

  while (round < maxRounds) {
    round++

    const params = {
      model: ctx.aiModel,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }

    if (tools.length > 0) {
      params.tools = tools
      params.tool_choice = "auto"
    }

    console.log(`[MW:AI] Round ${round} — sending to ${ctx.aiModel}...`)
    const completion = await openai.chat.completions.create(params)
    const choice = completion.choices[0]

    if (choice.finish_reason === "tool_calls" || choice.message.tool_calls?.length > 0) {
      messages.push(choice.message)

      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function.name
        const toolArgs = JSON.parse(toolCall.function.arguments || "{}")

        console.log(`[MW:AI] Tool call: ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)})`)

        const tool = TOOLS.find((t) => t.definition.function.name === toolName)
        let result = "Tool not found."

        if (tool) {
          try {
            if (ctx.onTyping) ctx.onTyping()
            result = await tool.execute(toolArgs)
            ctx.toolsUsed.push(toolName)
          } catch (err) {
            console.error(`[MW:AI] Tool error (${toolName}):`, err.message)
            result = `Error: ${err.message}`
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        })
      }
      continue
    }

    ctx.reply = choice.message.content || "Sorry, I couldn't generate a response."
    break
  }

  if (!ctx.reply) {
    ctx.reply = "Sorry, I took too long thinking. Please try again."
  }

  const elapsed = Date.now() - ctx.startTime
  console.log(
    `[MW:AI] Response ready (${elapsed}ms, ${round} round${round > 1 ? "s" : ""}${ctx.toolsUsed.length > 0 ? ", tools: " + ctx.toolsUsed.join(", ") : ""})`
  )
}

async function storeMessages(ctx) {
  const saveNow = new Date().toISOString()

  await pool.query(
    'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
    [cuid(), ctx.convoId, "user", ctx.text, ctx.now]
  )

  await pool.query(
    'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
    [cuid(), ctx.convoId, "assistant", ctx.reply, saveNow]
  )

  await pool.query('UPDATE "Conversation" SET "updatedAt" = $1 WHERE id = $2', [saveNow, ctx.convoId])
}

/**
 * Full shared pipeline: session → convo → history → AI → store
 */
async function processSharedPipeline(ctx) {
  await getOrCreateConvo(ctx)
  await loadHistory(ctx)
  await callAI(ctx)
  await storeMessages(ctx)
}

// ── Helper: write channel event to DB ────────────────────────────────

async function writeChannelEvent(userId, channelType, eventType, payload) {
  await pool.query(
    'INSERT INTO channel_events (id, user_id, channel_type, event_type, payload, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
    [cuid(), userId, channelType, eventType, payload || null]
  )
}

// ══════════════════════════════════════════════════════════════════════
// CHANNEL: TELEGRAM
// ══════════════════════════════════════════════════════════════════════

let TG_BOT_TOKEN = ""
const TG = (method) => `https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`

async function tgSend(chatId, text, replyToId) {
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
      console.error("[TG] Send failed:", data.description)
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

function tgTyping(chatId) {
  fetch(TG("sendChatAction"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  }).catch(() => {})
}

async function processTelegramMessage(msg, tgUserId) {
  const chatId = String(msg.chat.id)
  const text = (msg.text || "").trim()
  if (!text) return

  console.log(`[TG:Receive] From ${msg.from?.first_name || "User"} (${chatId}): "${text.slice(0, 60)}"`)

  const ctx = {
    channelType: "telegram",
    channelName: "Telegram",
    channelPeer: chatId,
    text,
    startTime: Date.now(),
    userId: tgUserId,
    toolsUsed: [],
    onTyping: () => tgTyping(chatId),
  }

  try {
    await processSharedPipeline(ctx)
    await tgSend(chatId, ctx.reply, msg.message_id)
    const preview = (s) => (s || "").slice(0, 50).replace(/\n/g, " ")
    console.log(`[TG] ${msg.from?.first_name}: "${preview(text)}" → "${preview(ctx.reply)}"`)
  } catch (err) {
    console.error("[TG] Pipeline error:", err.message)
    await tgSend(chatId, "Sorry, something went wrong. Please try again.").catch(() => {})
  }
}

async function startTelegram() {
  // Resolve bot token
  TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
  let tgUserId = null

  if (!TG_BOT_TOKEN) {
    try {
      const res = await pool.query(
        'SELECT "userId", config FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
        ["telegram"]
      )
      if (res.rows.length > 0) {
        tgUserId = res.rows[0].userId
        const raw = res.rows[0].config
        const config = typeof raw === "string" ? JSON.parse(raw) : raw
        if (config?.botToken) TG_BOT_TOKEN = config.botToken
      }
    } catch (err) {
      console.error("[TG] DB error:", err.message)
    }
  }

  if (!TG_BOT_TOKEN) {
    console.log("[TG] No bot token configured — skipping Telegram")
    return
  }

  // If we didn't get userId from DB, find it
  if (!tgUserId) {
    const res = await pool.query(
      'SELECT "userId" FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
      ["telegram"]
    )
    tgUserId = res.rows[0]?.userId
  }

  if (!tgUserId) {
    console.log("[TG] No user has Telegram enabled — skipping")
    return
  }

  // Delete any webhook (can't use both webhook and polling)
  await fetch(TG("deleteWebhook"), { method: "POST" }).catch(() => {})

  // Verify bot connection
  const me = await fetch(TG("getMe"))
  const meData = await me.json()
  if (!meData.ok) {
    console.error("[TG] Invalid token:", meData.description)
    return
  }

  console.log(`[TG] Connected as @${meData.result.username}`)

  // Long-polling loop
  let offset = 0
  const pollLoop = async () => {
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

            if (msg.text === "/start") {
              await tgSend(
                String(msg.chat.id),
                "Welcome to DMMS AI! I'm your smart AI assistant.\n\nI can answer questions, search the web, give you news, weather, and more.\n\nJust send me any message!\n\nCommands:\n/new — Start a fresh conversation\n\nPowered by DMMS AI — Every Messenger is AI Now."
              )
              continue
            }

            if (msg.text === "/new") {
              await tgSend(String(msg.chat.id), "Fresh start! Send me anything.")
              continue
            }

            tgTyping(String(msg.chat.id))
            processTelegramMessage(msg, tgUserId).catch((err) => {
              console.error("[TG] Unhandled:", err.message)
            })
          }
        }
      } catch (err) {
        if (err.name !== "AbortError" && err.name !== "TimeoutError") {
          console.error("[TG] Poll error:", err.message)
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }

  pollLoop()
}

// ══════════════════════════════════════════════════════════════════════
// CHANNEL: WHATSAPP (Baileys — QR Code Scan)
// ══════════════════════════════════════════════════════════════════════

let waSocket = null

async function startWhatsApp() {
  let waUserId = null
  let waChannelConfig = null

  try {
    const res = await pool.query(
      'SELECT "userId", config FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
      ["whatsapp"]
    )
    if (res.rows.length === 0) {
      console.log("[WA] No WhatsApp channel enabled — skipping")
      return
    }
    waUserId = res.rows[0].userId
    const raw = res.rows[0].config
    waChannelConfig = typeof raw === "string" ? JSON.parse(raw) : raw

    // If config has accessToken, it's Business API mode — skip Baileys
    if (waChannelConfig?.accessToken) {
      console.log("[WA] WhatsApp Business API mode detected — using webhook, not Baileys")
      return
    }
  } catch (err) {
    console.error("[WA] DB error:", err.message)
    return
  }

  console.log(`[WA] Starting WhatsApp (Baileys) for user ${waUserId.slice(0, 8)}...`)

  await connectWhatsApp(waUserId)
}

async function connectWhatsApp(userId, retryCount = 0) {
  try {
    const { state, saveCreds, pool: authPool } = await usePgAuthState(
      process.env.DATABASE_URL,
      userId
    )

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ["DMMS AI", "Chrome", "1.0.0"],
      connectTimeoutMs: 60000,
    })

    waSocket = sock

    // Handle connection updates
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        console.log("[WA] QR code received — writing to channel_events")
        await writeChannelEvent(userId, "whatsapp", "qr", qr)
      }

      if (connection === "close") {
        waSocket = null
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        console.log(`[WA] Connection closed (code: ${statusCode})`)
        await writeChannelEvent(userId, "whatsapp", "disconnected", String(statusCode))

        // Update channel status in DB
        await pool.query(
          'UPDATE "UserChannel" SET status = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "channelType" = $3',
          ["disconnected", userId, "whatsapp"]
        ).catch(() => {})

        if (shouldReconnect && retryCount < 5) {
          const delay = Math.min(3000 * Math.pow(2, retryCount), 30000)
          console.log(`[WA] Reconnecting in ${delay / 1000}s (attempt ${retryCount + 1})...`)
          setTimeout(() => connectWhatsApp(userId, retryCount + 1), delay)
        } else if (!shouldReconnect) {
          console.log("[WA] Logged out — clearing auth state")
          await pool.query("DELETE FROM baileys_auth WHERE user_id = $1", [userId])
          await writeChannelEvent(userId, "whatsapp", "logged_out", null)
        }
      }

      if (connection === "open") {
        console.log("[WA] Connected successfully!")
        await writeChannelEvent(userId, "whatsapp", "connected", null)

        // Update channel status in DB
        await pool.query(
          'UPDATE "UserChannel" SET status = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "channelType" = $3',
          ["connected", userId, "whatsapp"]
        ).catch(() => {})
      }
    })

    // Handle credential updates
    sock.ev.on("creds.update", saveCreds)

    // Handle incoming messages
    sock.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
      if (type !== "notify") return

      for (const msg of msgs) {
        // Skip messages sent by us
        if (msg.key.fromMe) continue

        // Extract text from message
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          ""

        if (!text.trim()) continue

        const jid = msg.key.remoteJid
        const pushName = msg.pushName || "User"
        const peer = jid.replace(/@s\.whatsapp\.net$/, "")

        console.log(`[WA:Receive] From ${pushName} (${peer}): "${text.slice(0, 60)}"`)

        const ctx = {
          channelType: "whatsapp",
          channelName: "WhatsApp",
          channelPeer: peer,
          text: text.trim(),
          startTime: Date.now(),
          userId,
          toolsUsed: [],
          onTyping: () => {
            sock.sendPresenceUpdate("composing", jid).catch(() => {})
          },
        }

        try {
          await processSharedPipeline(ctx)

          // Send reply
          const chunks = []
          for (let i = 0; i < ctx.reply.length; i += 4000) {
            chunks.push(ctx.reply.slice(i, i + 4000))
          }
          for (const chunk of chunks) {
            await sock.sendMessage(jid, { text: chunk })
          }

          sock.sendPresenceUpdate("available", jid).catch(() => {})

          const preview = (s) => (s || "").slice(0, 50).replace(/\n/g, " ")
          console.log(`[WA] ${pushName}: "${preview(text)}" → "${preview(ctx.reply)}"`)
        } catch (err) {
          console.error("[WA] Pipeline error:", err.message)
          await sock.sendMessage(jid, { text: "Sorry, something went wrong. Please try again." }).catch(() => {})
        }
      }
    })
  } catch (err) {
    console.error("[WA] Fatal error:", err.message)
    if (retryCount < 5) {
      const delay = Math.min(3000 * Math.pow(2, retryCount), 30000)
      console.log(`[WA] Retrying in ${delay / 1000}s...`)
      setTimeout(() => connectWhatsApp(userId, retryCount + 1), delay)
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// CHANNEL: DISCORD
// ══════════════════════════════════════════════════════════════════════

async function startDiscord() {
  let discordUserId = null
  let discordToken = null

  try {
    const res = await pool.query(
      'SELECT "userId", config FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
      ["discord"]
    )
    if (res.rows.length === 0) {
      console.log("[DC] No Discord channel enabled — skipping")
      return
    }

    discordUserId = res.rows[0].userId
    const raw = res.rows[0].config
    const config = typeof raw === "string" ? JSON.parse(raw) : raw
    discordToken = config?.botToken || process.env.DISCORD_BOT_TOKEN
  } catch (err) {
    console.error("[DC] DB error:", err.message)
    return
  }

  if (!discordToken) {
    console.log("[DC] No Discord bot token configured — skipping")
    return
  }

  console.log("[DC] Starting Discord bot...")

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  })

  client.on("ready", () => {
    console.log(`[DC] Connected as ${client.user.tag}`)
    writeChannelEvent(discordUserId, "discord", "connected", client.user.tag).catch(() => {})

    pool.query(
      'UPDATE "UserChannel" SET status = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "channelType" = $3',
      ["connected", discordUserId, "discord"]
    ).catch(() => {})
  })

  client.on("messageCreate", async (message) => {
    // Skip bot's own messages and other bots
    if (message.author.bot) return

    const text = message.content?.trim()
    if (!text) return

    // Use channel ID + author ID as peer for conversations
    const peer = `${message.channel.id}:${message.author.id}`

    console.log(`[DC:Receive] From ${message.author.username} in #${message.channel.name || "DM"}: "${text.slice(0, 60)}"`)

    const ctx = {
      channelType: "discord",
      channelName: "Discord",
      channelPeer: peer,
      text,
      startTime: Date.now(),
      userId: discordUserId,
      toolsUsed: [],
      onTyping: () => {
        message.channel.sendTyping().catch(() => {})
      },
    }

    try {
      message.channel.sendTyping().catch(() => {})
      await processSharedPipeline(ctx)

      // Split long messages (Discord limit: 2000 chars)
      const chunks = []
      for (let i = 0; i < ctx.reply.length; i += 1900) {
        chunks.push(ctx.reply.slice(i, i + 1900))
      }

      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await message.reply(chunks[i])
        } else {
          await message.channel.send(chunks[i])
        }
      }

      const preview = (s) => (s || "").slice(0, 50).replace(/\n/g, " ")
      console.log(`[DC] ${message.author.username}: "${preview(text)}" → "${preview(ctx.reply)}"`)
    } catch (err) {
      console.error("[DC] Pipeline error:", err.message)
      await message.reply("Sorry, something went wrong. Please try again.").catch(() => {})
    }
  })

  client.on("error", (err) => {
    console.error("[DC] Client error:", err.message)
  })

  try {
    await client.login(discordToken)
  } catch (err) {
    console.error("[DC] Login failed:", err.message)
    writeChannelEvent(discordUserId, "discord", "error", err.message).catch(() => {})
  }
}

// ══════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗")
  console.log("║  DMMS AI — Multi-Channel Gateway v3.0               ║")
  console.log("║  Every Messenger is AI Now.                          ║")
  console.log("╚══════════════════════════════════════════════════════╝")
  console.log(`[Gateway] Tools: ${TOOLS.map((t) => t.definition.function.name).join(", ")}`)
  console.log("[Gateway] Starting channels...")

  // Start all channels concurrently
  const results = await Promise.allSettled([
    startTelegram(),
    startWhatsApp(),
    startDiscord(),
  ])

  for (const [i, result] of results.entries()) {
    const names = ["Telegram", "WhatsApp", "Discord"]
    if (result.status === "rejected") {
      console.error(`[Gateway] ${names[i]} failed to start:`, result.reason?.message || result.reason)
    }
  }

  console.log("[Gateway] All channels initialized. Waiting for messages...")

  // Keep the process alive
  process.on("SIGINT", async () => {
    console.log("\n[Gateway] Shutting down gracefully...")
    if (waSocket) {
      waSocket.end()
    }
    await pool.end()
    process.exit(0)
  })

  process.on("SIGTERM", async () => {
    console.log("[Gateway] SIGTERM received, shutting down...")
    if (waSocket) {
      waSocket.end()
    }
    await pool.end()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error("[Gateway] Fatal:", err)
  process.exit(1)
})
