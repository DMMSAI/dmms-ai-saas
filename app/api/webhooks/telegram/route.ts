import { NextResponse } from "next/server"
import { pool, cuid } from "@/lib/db"
import { ProviderManager } from "@/core/providers/manager"
import { ProviderMessage } from "@/core/providers/base"

export async function POST(req: Request) {
  try {
    const update = await req.json()
    console.log("[Telegram Webhook] Received update:", JSON.stringify(update).slice(0, 200))

    // Extract message from Telegram update
    const message = update.message || update.edited_message
    if (!message?.text) {
      return NextResponse.json({ ok: true })
    }

    const chatId = String(message.chat.id)
    const fromId = String(message.from?.id || "")
    const text = message.text

    // Skip bot commands like /start
    if (text === "/start") {
      await sendTelegramReply(chatId, "Welcome to DMMS AI! Send me any message and I'll respond with AI. 🤖")
      return NextResponse.json({ ok: true })
    }

    // Find which user has Telegram enabled
    const channelRes = await pool.query(
      'SELECT * FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
      ["telegram"]
    )
    const userChannel = channelRes.rows[0]
    if (!userChannel) {
      console.log("[Telegram Webhook] No enabled Telegram channel found")
      return NextResponse.json({ ok: true })
    }

    // Parse the stored config to get the bot token
    let config: Record<string, string> = {}
    try {
      config = typeof userChannel.config === "string" ? JSON.parse(userChannel.config) : userChannel.config
    } catch {
      config = {}
    }
    const botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      console.log("[Telegram Webhook] No bot token found")
      return NextResponse.json({ ok: true })
    }

    // Get the user's OpenAI API key
    const apiKeyRes = await pool.query(
      'SELECT "apiKey" FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
      [userChannel.userId, "openai"]
    )
    const apiKey = apiKeyRes.rows[0]?.apiKey || process.env.OPENAI_API_KEY
    if (!apiKey) {
      await sendTelegramMessage(botToken, chatId, "No OpenAI API key configured. Please add one in the DMMS AI dashboard settings.")
      return NextResponse.json({ ok: true })
    }

    // Get or create conversation for this Telegram chat
    let convoRes = await pool.query(
      'SELECT id, "aiModel" FROM "Conversation" WHERE "userId" = $1 AND "channelType" = $2 AND "channelPeer" = $3 ORDER BY "updatedAt" DESC LIMIT 1',
      [userChannel.userId, "telegram", chatId]
    )

    let convoId: string
    let aiModel: string

    if (convoRes.rows.length > 0) {
      convoId = convoRes.rows[0].id
      aiModel = convoRes.rows[0].aiModel || "gpt-4o"
    } else {
      convoId = cuid()
      aiModel = "gpt-4o"
      const now = new Date().toISOString()
      await pool.query(
        'INSERT INTO "Conversation" (id, "userId", "channelType", "channelPeer", title, "aiModel", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [convoId, userChannel.userId, "telegram", chatId, text.slice(0, 50), aiModel, now, now]
      )
    }

    // Save user message
    const userMsgId = cuid()
    const now = new Date().toISOString()
    await pool.query(
      'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      [userMsgId, convoId, "user", text, now]
    )

    // Build context from conversation history
    const messagesRes = await pool.query(
      'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" ASC LIMIT 50',
      [convoId]
    )

    const context: ProviderMessage[] = [
      { role: "system", content: "You are DMMS AI, a helpful AI assistant on Telegram. Be knowledgeable, friendly, and concise." },
      ...messagesRes.rows.map((m) => ({ role: m.role as ProviderMessage["role"], content: m.content })),
    ]

    // Call OpenAI
    const pm = new ProviderManager()
    const provider = pm.getOrCreate("openai", { apiKey })

    let fullResponse = ""
    for await (const chunk of provider.chat(context, { model: aiModel })) {
      if (chunk.type === "text" && chunk.content) {
        fullResponse += chunk.content
      }
      if (chunk.type === "error") {
        fullResponse = `Error: ${chunk.error}`
        break
      }
    }

    if (!fullResponse) {
      fullResponse = "Sorry, I couldn't generate a response. Please try again."
    }

    // Save assistant message
    const asstMsgId = cuid()
    const saveNow = new Date().toISOString()
    await pool.query(
      'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      [asstMsgId, convoId, "assistant", fullResponse, saveNow]
    )
    await pool.query(
      'UPDATE "Conversation" SET "updatedAt" = $1 WHERE id = $2',
      [saveNow, convoId]
    )

    // Send reply to Telegram
    await sendTelegramMessage(botToken, chatId, fullResponse, message.message_id)

    console.log(`[Telegram Webhook] Replied to chat ${chatId}: ${fullResponse.slice(0, 50)}...`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[Telegram Webhook] Error:", err)
    return NextResponse.json({ ok: true }) // Always 200 to Telegram
  }
}

/** Send a message via Telegram Bot API */
async function sendTelegramMessage(botToken: string, chatId: string, text: string, replyToMessageId?: number) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  }
  if (replyToMessageId) {
    body.reply_parameters = { message_id: replyToMessageId }
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    // Retry without markdown if it fails (markdown can cause issues)
    body.parse_mode = undefined
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }
}

/** Quick reply helper (uses env bot token) */
async function sendTelegramReply(chatId: string, text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return
  await sendTelegramMessage(botToken, chatId, text)
}
