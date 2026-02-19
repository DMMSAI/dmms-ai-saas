import { NextRequest, NextResponse } from "next/server"
import { pool, cuid } from "@/lib/db"
import OpenAI from "openai"

/**
 * WhatsApp Business Cloud API — Webhook Handler
 *
 * Middleware Pipeline (same as Telegram):
 *   Meta Webhook → Receive → Session → AI (+ Tools) → Store → Send → WhatsApp
 *
 * Setup required in Meta Developer Portal:
 *   1. Create a Meta App with WhatsApp product
 *   2. Set webhook URL to: https://your-domain.com/api/webhooks/whatsapp
 *   3. Set verify token to match WHATSAPP_VERIFY_TOKEN
 *   4. Subscribe to "messages" webhook field
 *   5. Get a permanent access token and phone number ID
 */

const WA_API = "https://graph.facebook.com/v21.0"

// ── GET: Webhook Verification (Meta Challenge-Response) ──────────────

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const mode = params.get("hub.mode")
  const token = params.get("hub.verify_token")
  const challenge = params.get("hub.challenge")

  // Load verify token from DB or env
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

  // Return 200 immediately (Meta requires fast response)
  // Process message asynchronously
  processWebhook(body).catch((err) => {
    console.error("[WA] Processing error:", err.message)
  })

  return NextResponse.json({ status: "ok" })
}

// ── Message Processing Pipeline ──────────────────────────────────────

async function processWebhook(body: WebhookBody) {
  // Extract messages from the webhook payload
  const entry = body.entry?.[0]
  const changes = entry?.changes?.[0]
  const value = changes?.value

  if (!value?.messages?.length) return // Not a message event (could be status update)

  const message = value.messages[0]
  const contact = value.contacts?.[0]
  const metadata = value.metadata

  // Only handle text messages for now
  if (message.type !== "text") {
    console.log(`[WA] Skipping non-text message type: ${message.type}`)
    return
  }

  const ctx: WaContext = {
    phoneNumberId: metadata.phone_number_id,
    from: message.from, // sender's phone number
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
      `[WA] ${ctx.userName}: "${ctx.text.slice(0, 40)}" → "${(ctx.reply || "").slice(0, 40)}" (${elapsed}ms)`
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
    [ctx.userId, "whatsapp", ctx.from]
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
      [ctx.convoId, ctx.userId, "whatsapp", ctx.from, ctx.text.slice(0, 50), ctx.aiModel, ctx.now, ctx.now]
    )
  }

  // Load recent history
  const historyRes = await pool.query(
    'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" DESC LIMIT 10',
    [ctx.convoId]
  )
  ctx.history = historyRes.rows.reverse()

  console.log(`[WA:Session] Conversation ${(ctx.convoId || "").slice(0, 8)}... | ${(ctx.history || []).length} prior messages`)
}

// ── AI Middleware (with Tools) ───────────────────────────────────────

const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the internet for current/real-time information including weather, news, prices, sports scores, events, people, places, or any factual question.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_datetime",
      description: "Get the current date, time, and day of the week.",
      parameters: { type: "object", properties: {} },
    },
  },
]

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
  const openai = new OpenAI({ apiKey: ctx.apiKey })

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    ...(ctx.history || []).map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: ctx.text },
  ]

  let maxRounds = 3
  let round = 0

  while (round < maxRounds) {
    round++
    console.log(`[WA:AI] Round ${round} — sending to ${ctx.aiModel}...`)

    const completion = await openai.chat.completions.create({
      model: ctx.aiModel!,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      tools: TOOLS,
      tool_choice: "auto",
    })

    const choice = completion.choices[0]

    if (choice.finish_reason === "tool_calls" || choice.message.tool_calls?.length) {
      messages.push(choice.message)

      for (const toolCall of choice.message.tool_calls || []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc = toolCall as any
        const fnName = tc.function?.name || tc.name || ""
        const fnArgs = tc.function?.arguments || "{}"
        const tcId = tc.id || ""
        const args = JSON.parse(fnArgs)
        console.log(`[WA:AI] Tool: ${fnName}(${JSON.stringify(args).slice(0, 80)})`)

        let result: string
        if (fnName === "web_search") {
          result = await webSearch(args.query)
          ctx.toolsUsed.push("web_search")
        } else if (fnName === "get_datetime") {
          const now = new Date()
          result = JSON.stringify({
            date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
            time: now.toLocaleTimeString("en-US", { hour12: true }),
            timezone: "UTC",
          })
          ctx.toolsUsed.push("get_datetime")
        } else {
          result = "Tool not found."
        }

        messages.push({ role: "tool", tool_call_id: tcId, content: result })
      }
      continue
    }

    ctx.reply = choice.message.content || "Sorry, I couldn't generate a response."
    break
  }

  if (!ctx.reply) ctx.reply = "Sorry, I took too long thinking. Please try again."

  const elapsed = Date.now() - ctx.startTime
  console.log(`[WA:AI] Response ready (${elapsed}ms, ${round} rounds${ctx.toolsUsed.length ? ", tools: " + ctx.toolsUsed.join(", ") : ""})`)
}

// ── Web Search (DuckDuckGo) ──────────────────────────────────────────

async function webSearch(query: string): Promise<string> {
  console.log(`[WA:Search] Searching: "${query}"`)

  try {
    const res = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "DMMS-AI/2.0",
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(8000),
    })

    const html = await res.text()
    const results: { title: string; snippet: string }[] = []

    const snippetRegex = /<td\s+class=['"]result-snippet['"]>([\s\S]*?)<\/td>/gi
    const linkRegex = /<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi

    const snippets: string[] = []
    const titles: string[] = []
    let m: RegExpExecArray | null

    while ((m = snippetRegex.exec(html)) !== null && snippets.length < 5) {
      snippets.push(m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim())
    }

    while ((m = linkRegex.exec(html)) !== null && titles.length < 5) {
      titles.push(m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim())
    }

    for (let i = 0; i < Math.max(snippets.length, titles.length); i++) {
      results.push({ title: titles[i] || "", snippet: snippets[i] || "" })
    }

    if (results.length === 0) {
      return `No search results found for: "${query}". Please answer based on your knowledge.`
    }

    return `Web search results for "${query}":\n\n${results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join("\n\n")}\n\nUse these results to give an accurate answer.`
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    return `Web search failed (${msg}). Answer based on your knowledge.`
  }
}

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
  // WhatsApp has a 4096 char limit per message
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
