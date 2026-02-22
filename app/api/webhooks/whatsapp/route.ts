import { NextRequest, NextResponse } from "next/server"
import { pool, cuid } from "@/lib/db"

/**
 * WhatsApp Business Cloud API — Webhook Handler
 *
 * Middleware Pipeline:
 *   Meta Webhook → Receive → Session → AI (+ Tools) → Store → Send → WhatsApp
 *
 * Now supports multi-provider AI routing (OpenAI, Gemini, Anthropic).
 */

const WA_API = "https://graph.facebook.com/v21.0"

// ── GET: Webhook Verification (Meta Challenge-Response) ──────────────

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const mode = params.get("hub.mode")
  const token = params.get("hub.verify_token")
  const challenge = params.get("hub.challenge")

  const verifyToken = await getVerifyToken()

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[WA] Webhook verified")
    return new Response(challenge, { status: 200 })
  }

  console.error("[WA] Webhook verification failed")
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

// ── POST: Receive Messages from WhatsApp ─────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json()

  processWebhook(body).catch((err) => {
    console.error("[WA] Processing error:", err.message)
  })

  return NextResponse.json({ status: "ok" })
}

// ── Message Processing Pipeline ──────────────────────────────────────

async function processWebhook(body: WebhookBody) {
  const entry = body.entry?.[0]
  const changes = entry?.changes?.[0]
  const value = changes?.value

  if (!value?.messages?.length) return

  const message = value.messages[0]
  const contact = value.contacts?.[0]
  const metadata = value.metadata

  if (message.type !== "text") {
    console.log(`[WA] Skipping non-text message type: ${message.type}`)
    return
  }

  const ctx: WaContext = {
    phoneNumberId: metadata.phone_number_id,
    from: message.from,
    text: message.text.body.trim(),
    messageId: message.id,
    userName: contact?.profile?.name || "User",
    timestamp: message.timestamp,
    startTime: Date.now(),
    toolsUsed: [],
  }

  if (!ctx.text) return

  console.log(`[WA:Receive] From ${ctx.userName} (${ctx.from}): "${ctx.text.slice(0, 60)}"`)

  try {
    await sessionMiddleware(ctx)
    await aiMiddleware(ctx)
    await storeMiddleware(ctx)
    await sendMiddleware(ctx)

    const elapsed = Date.now() - ctx.startTime
    console.log(
      `[WA] ${ctx.userName}: "${ctx.text.slice(0, 40)}" → "${(ctx.reply || "").slice(0, 40)}" (${elapsed}ms, provider: ${ctx.aiProvider})`
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error("[WA] Pipeline error:", msg)
    if (ctx.accessToken && ctx.phoneNumberId) {
      await waSend(ctx.phoneNumberId, ctx.accessToken, ctx.from, "Sorry, something went wrong. Please try again.").catch(() => {})
    }
  }
}

// ── Session Middleware ────────────────────────────────────────────────

async function sessionMiddleware(ctx: WaContext) {
  // Find the WhatsApp channel owner
  const channelRes = await pool.query(
    'SELECT "userId", config FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
    ["whatsapp"]
  )
  if (channelRes.rows.length === 0) throw new Error("No WhatsApp channel configured")

  ctx.userId = channelRes.rows[0].userId
  const rawConfig = channelRes.rows[0].config
  const config = typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig
  ctx.accessToken = config.accessToken
  if (!ctx.accessToken) throw new Error("No WhatsApp access token configured")

  // ── Look up the user's active AI provider and model from settings ──
  const settingsRes = await pool.query(
    'SELECT "defaultAiProvider", "defaultAiModel" FROM "User" WHERE id = $1',
    [ctx.userId]
  )
  const userSettings = settingsRes.rows[0]
  const activeProvider = userSettings?.defaultAiProvider || "openai"
  const activeModel = userSettings?.defaultAiModel || "gpt-4o"

  // Get API key for the user's ACTIVE provider (not hardcoded to openai)
  const keyRes = await pool.query(
    'SELECT "apiKey" FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
    [ctx.userId, activeProvider]
  )

  const envKeyMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
  }
  ctx.apiKey = keyRes.rows[0]?.apiKey || process.env[envKeyMap[activeProvider] || "OPENAI_API_KEY"]
  if (!ctx.apiKey) throw new Error(`No ${activeProvider} API key configured`)

  ctx.aiProvider = activeProvider
  ctx.aiModel = activeModel

  // Get or create conversation
  const convoRes = await pool.query(
    'SELECT id, "aiModel", "aiProvider" FROM "Conversation" WHERE "userId" = $1 AND "channelType" = $2 AND "channelPeer" = $3 ORDER BY "updatedAt" DESC LIMIT 1',
    [ctx.userId, "whatsapp", ctx.from]
  )

  ctx.now = new Date().toISOString()

  if (convoRes.rows.length > 0) {
    ctx.convoId = convoRes.rows[0].id
    // Use conversation's provider/model if set, otherwise use user's active settings
    ctx.aiModel = convoRes.rows[0].aiModel || activeModel
    ctx.aiProvider = convoRes.rows[0].aiProvider || activeProvider
  } else {
    ctx.convoId = cuid()
    await pool.query(
      'INSERT INTO "Conversation" (id, "userId", "channelType", "channelPeer", title, "aiModel", "aiProvider", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [ctx.convoId, ctx.userId, "whatsapp", ctx.from, ctx.text.slice(0, 50), ctx.aiModel, ctx.aiProvider, ctx.now, ctx.now]
    )
  }

  // Load recent history
  const historyRes = await pool.query(
    'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" DESC LIMIT 10',
    [ctx.convoId]
  )
  ctx.history = historyRes.rows.reverse()

  console.log(`[WA:Session] Conversation ${(ctx.convoId || "").slice(0, 8)}... | Provider: ${ctx.aiProvider} | Model: ${ctx.aiModel} | ${(ctx.history || []).length} prior messages`)
}

// ── AI Middleware (Multi-Provider + Tools) ────────────────────────────

function buildSystemPrompt(): string {
  const now = new Date()
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const timeStr = now.toLocaleTimeString("en-US", { hour12: true })

  return `You are DMMS AI, an intelligent AI assistant on WhatsApp. Today is ${dateStr}, ${timeStr} UTC.

CAPABILITIES:
- You can search the internet for real-time information (weather, news, prices, events, etc.)
- You have access to tools: use web_search when you need current/live data
- You remember the conversation context

RULES:
- Read the user's message carefully and answer their EXACT question
- When asked about weather, news, prices, sports, or current events: ALWAYS use the web_search tool first
- Be helpful, accurate, and direct
- Keep responses concise but complete (under 500 characters when possible)
- Use plain text — no markdown, no asterisks, no code blocks
- If the user greets you, greet them warmly and ask how you can help
- Be conversational and natural, like a smart friend

IDENTITY:
- You are DMMS AI, NOT ChatGPT, NOT Google, NOT Siri
- Your tagline: "Every Messenger is AI Now"`
}

async function aiMiddleware(ctx: WaContext) {
  const provider = ctx.aiProvider || "openai"
  const systemPrompt = buildSystemPrompt()

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...(ctx.history || []).map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: ctx.text },
  ]

  const apiKey = ctx.apiKey!
  const model = ctx.aiModel || "gpt-4o"
  console.log(`[WA:AI] Using provider: ${provider}, model: ${model}`)

  try {
    if (provider === "anthropic") {
      const { callAnthropic } = await import("@/lib/ai/anthropic.mjs")
      const result = await callAnthropic(apiKey, messages, model)
      ctx.reply = result.reply
      ctx.toolsUsed.push(...result.toolsUsed)
    } else if (provider === "gemini") {
      const { callGemini } = await import("@/lib/ai/gemini.mjs")
      const result = await callGemini(apiKey, messages, model)
      ctx.reply = result.reply
      ctx.toolsUsed.push(...result.toolsUsed)
    } else {
      // OpenAI (default)
      const { callOpenAI } = await import("@/lib/ai/openai.mjs")
      const result = await callOpenAI(apiKey, messages, model)
      ctx.reply = result.reply
      ctx.toolsUsed.push(...result.toolsUsed)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI error"
    console.error(`[WA:AI] ${provider} error:`, msg)
    throw new Error(`AI provider (${provider}) error: ${msg}`)
  }

  if (!ctx.reply) ctx.reply = "Sorry, I couldn't generate a response."

  const elapsed = Date.now() - ctx.startTime
  console.log(`[WA:AI] Response ready (${elapsed}ms, ${provider}${ctx.toolsUsed.length ? ", tools: " + ctx.toolsUsed.join(", ") : ""})`)
}

// ── Web Search (DuckDuckGo) — kept for OpenAI tool calls in webhook ──

// Note: Gemini/Anthropic tool calls are handled by their own providers in lib/ai/

// ── Store Middleware ──────────────────────────────────────────────────

async function storeMiddleware(ctx: WaContext) {
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

// ── Send Middleware — Send reply via WhatsApp Cloud API ──────────────

async function sendMiddleware(ctx: WaContext) {
  await waSend(ctx.phoneNumberId, ctx.accessToken!, ctx.from, ctx.reply!)
}

async function waSend(phoneNumberId: string, accessToken: string, to: string, text: string) {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.slice(i, i + 4000))
  }

  for (const chunk of chunks) {
    const res = await fetch(`${WA_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk },
      }),
    })

    const data = await res.json()
    if (data.error) {
      console.error("[WA] Send failed:", data.error.message)
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

async function getVerifyToken(): Promise<string> {
  const fallback = process.env.WHATSAPP_VERIFY_TOKEN || "dmmsai_whatsapp_verify_2026"
  try {
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error("DB timeout")), 5000)
    )
    const queryPromise = pool.query(
      'SELECT config FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
      ["whatsapp"]
    )
    const res = await Promise.race([queryPromise, timeoutPromise])
    if (res && res.rows.length > 0) {
      const raw = res.rows[0].config
      const config = typeof raw === "string" ? JSON.parse(raw) : raw
      if (config?.verifyToken) return config.verifyToken
    }
  } catch (err) {
    console.error("[WA] getVerifyToken error:", err instanceof Error ? err.message : err)
  }
  return fallback
}

// ── Types ────────────────────────────────────────────────────────────

interface WaContext {
  phoneNumberId: string
  from: string
  text: string
  messageId: string
  userName: string
  timestamp: string
  startTime: number
  toolsUsed: string[]
  userId?: string
  apiKey?: string
  accessToken?: string
  convoId?: string
  aiModel?: string
  aiProvider?: string
  now?: string
  history?: { role: string; content: string }[]
  reply?: string
}

interface WebhookBody {
  object?: string
  entry?: {
    id: string
    changes: {
      value: {
        messaging_product: string
        metadata: { phone_number_id: string; display_phone_number: string }
        contacts?: { profile: { name: string }; wa_id: string }[]
        messages?: {
          from: string
          id: string
          timestamp: string
          type: string
          text: { body: string }
        }[]
        statuses?: unknown[]
      }
      field: string
    }[]
  }[]
}
