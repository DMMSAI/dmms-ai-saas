import { NextResponse } from "next/server"
import { pool, cuid } from "@/lib/db"
import { ProviderManager } from "@/core/providers/manager"
import { ProviderMessage } from "@/core/providers/base"

export async function POST(req: Request) {
  let update: Record<string, unknown> = {}

  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const message = (update.message || update.edited_message) as Record<string, unknown> | undefined
  if (!message?.text) {
    return NextResponse.json({ ok: true })
  }

  const chat = message.chat as Record<string, unknown>
  const chatId = String(chat.id)
  const text = String(message.text)
  const messageId = Number(message.message_id)

  // Respond to Telegram immediately, process in background
  // This prevents Telegram webhook timeout
  processMessage(chatId, text, messageId).catch((err) => {
    console.error("[TG] Background processing error:", err)
  })

  return NextResponse.json({ ok: true })
}

async function processMessage(chatId: string, text: string, messageId: number) {
  try {
    console.log("[TG] Processing:", text.slice(0, 50))

    // Handle /start
    if (text === "/start") {
      await tgSend(chatId, "Welcome to DMMS AI! Send me any message and I'll respond with AI.")
      return
    }

    // Find enabled Telegram channel
    const channelRes = await pool.query(
      'SELECT * FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
      ["telegram"]
    )
    if (channelRes.rows.length === 0) {
      console.log("[TG] No enabled Telegram channel")
      return
    }

    const userChannel = channelRes.rows[0]

    // Parse config
    let config: Record<string, string> = {}
    try {
      config = typeof userChannel.config === "string"
        ? JSON.parse(userChannel.config)
        : (userChannel.config || {})
    } catch { config = {} }

    const botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      console.log("[TG] No bot token")
      return
    }

    // Get OpenAI key
    const apiKeyRes = await pool.query(
      'SELECT "apiKey" FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
      [userChannel.userId, "openai"]
    )
    const apiKey = apiKeyRes.rows[0]?.apiKey || process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.log("[TG] No OpenAI key, userId:", userChannel.userId)
      await tgSend(chatId, "No OpenAI API key configured. Add one in the dashboard Settings.", botToken)
      return
    }

    console.log("[TG] Got API key, sending typing indicator")

    // Typing indicator
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    }).catch(() => {})

    // Get or create conversation
    const convoRes = await pool.query(
      'SELECT id, "aiModel" FROM "Conversation" WHERE "userId" = $1 AND "channelType" = $2 AND "channelPeer" = $3 ORDER BY "updatedAt" DESC LIMIT 1',
      [userChannel.userId, "telegram", chatId]
    )

    let convoId: string
    let aiModel: string
    const now = new Date().toISOString()

    if (convoRes.rows.length > 0) {
      convoId = convoRes.rows[0].id
      aiModel = convoRes.rows[0].aiModel || "gpt-4o"
    } else {
      convoId = cuid()
      aiModel = "gpt-4o"
      await pool.query(
        'INSERT INTO "Conversation" (id, "userId", "channelType", "channelPeer", title, "aiModel", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [convoId, userChannel.userId, "telegram", chatId, text.slice(0, 50), aiModel, now, now]
      )
    }

    // Save user message
    await pool.query(
      'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      [cuid(), convoId, "user", text, now]
    )

    // Build context
    const historyRes = await pool.query(
      'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" ASC LIMIT 30',
      [convoId]
    )

    const context: ProviderMessage[] = [
      { role: "system", content: "You are DMMS AI, a helpful AI assistant on Telegram. Be knowledgeable, friendly, and concise. Keep responses short (under 500 characters when possible). Do NOT use markdown formatting." },
      ...historyRes.rows.map((m) => ({ role: m.role as ProviderMessage["role"], content: m.content })),
    ]

    // Call OpenAI
    console.log("[TG] Calling OpenAI, model:", aiModel, "messages:", context.length)
    const pm = new ProviderManager()
    const provider = pm.getOrCreate("openai", { apiKey })

    let fullResponse = ""
    for await (const chunk of provider.chat(context, { model: aiModel })) {
      if (chunk.type === "text" && chunk.content) {
        fullResponse += chunk.content
      }
      if (chunk.type === "error") {
        console.error("[TG] OpenAI error:", chunk.error)
        fullResponse = "Sorry, I encountered an error: " + chunk.error
        break
      }
    }

    if (!fullResponse) {
      fullResponse = "Sorry, I couldn't generate a response. Please try again."
    }

    console.log("[TG] AI response:", fullResponse.slice(0, 100))

    // Save assistant message
    const saveNow = new Date().toISOString()
    await pool.query(
      'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      [cuid(), convoId, "assistant", fullResponse, saveNow]
    )
    await pool.query(
      'UPDATE "Conversation" SET "updatedAt" = $1 WHERE id = $2',
      [saveNow, convoId]
    )

    // Send reply to Telegram
    console.log("[TG] Sending reply to Telegram")
    const result = await tgSend(chatId, fullResponse, botToken, messageId)
    console.log("[TG] Sent! Result ok:", result.ok)

  } catch (err) {
    console.error("[TG] Error:", err instanceof Error ? `${err.message}\n${err.stack}` : err)
    // Try to send error message to user
    try {
      await tgSend(chatId, "Sorry, something went wrong. Please try again.")
    } catch {}
  }
}

async function tgSend(
  chatId: string,
  text: string,
  botToken?: string,
  replyToId?: number
): Promise<Record<string, unknown>> {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, error: "no token" }

  // Split long messages (Telegram limit is 4096 chars)
  const chunks = []
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.slice(i, i + 4000))
  }

  let lastResult: Record<string, unknown> = {}
  for (let idx = 0; idx < chunks.length; idx++) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[idx],
    }
    if (replyToId && idx === 0) {
      body.reply_parameters = { message_id: replyToId }
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      lastResult = await res.json() as Record<string, unknown>
      if (!lastResult.ok) {
        console.error("[TG] sendMessage failed:", JSON.stringify(lastResult))
      }
    } catch (err) {
      console.error("[TG] sendMessage error:", err)
      lastResult = { ok: false }
    }
  }

  return lastResult
}
