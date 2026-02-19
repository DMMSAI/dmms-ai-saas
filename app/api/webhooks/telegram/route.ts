import { NextResponse } from "next/server"
import { pool, cuid } from "@/lib/db"
import OpenAI from "openai"

// Force Node.js runtime (not Edge)
export const runtime = "nodejs"

export async function POST(req: Request) {
  let update: Record<string, unknown> = {}

  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const message = (update.message || update.edited_message) as
    | Record<string, unknown>
    | undefined
  if (!message?.text) {
    return NextResponse.json({ ok: true })
  }

  const chat = message.chat as Record<string, unknown>
  const chatId = String(chat.id)
  const text = String(message.text)
  const messageId = Number(message.message_id)

  // --- Everything is SYNCHRONOUS — we finish all work before returning ---

  try {
    // Find enabled Telegram channel
    const channelRes = await pool.query(
      'SELECT * FROM "UserChannel" WHERE "channelType" = $1 AND enabled = true LIMIT 1',
      ["telegram"]
    )
    if (channelRes.rows.length === 0) {
      return NextResponse.json({ ok: true })
    }

    const userChannel = channelRes.rows[0]

    // Parse config
    let config: Record<string, string> = {}
    try {
      config =
        typeof userChannel.config === "string"
          ? JSON.parse(userChannel.config)
          : userChannel.config || {}
    } catch {
      config = {}
    }

    const botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      return NextResponse.json({ ok: true })
    }

    // Handle /start
    if (text === "/start") {
      await tgSend(
        chatId,
        "Welcome to DMMS AI! Send me any message and I'll respond with AI.",
        botToken
      )
      return NextResponse.json({ ok: true })
    }

    // Get OpenAI key
    const apiKeyRes = await pool.query(
      'SELECT "apiKey" FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
      [userChannel.userId, "openai"]
    )
    const apiKey = apiKeyRes.rows[0]?.apiKey || process.env.OPENAI_API_KEY
    if (!apiKey) {
      await tgSend(
        chatId,
        "No OpenAI API key configured. Please add one in the DMMS AI dashboard under Settings.",
        botToken
      )
      return NextResponse.json({ ok: true })
    }

    // Send typing indicator (best-effort, don't await)
    fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
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
      aiModel = convoRes.rows[0].aiModel || "gpt-4o-mini"
    } else {
      convoId = cuid()
      aiModel = "gpt-4o-mini"
      await pool.query(
        'INSERT INTO "Conversation" (id, "userId", "channelType", "channelPeer", title, "aiModel", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          convoId,
          userChannel.userId,
          "telegram",
          chatId,
          text.slice(0, 50),
          aiModel,
          now,
          now,
        ]
      )
    }

    // Save user message
    await pool.query(
      'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      [cuid(), convoId, "user", text, now]
    )

    // Build conversation context (last 20 messages)
    const historyRes = await pool.query(
      'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" ASC LIMIT 20',
      [convoId]
    )

    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [
        {
          role: "system",
          content:
            "You are DMMS AI, a helpful AI assistant on Telegram. Be knowledgeable, friendly, and concise. Keep responses under 500 characters when possible. Do NOT use markdown formatting — Telegram uses plain text.",
        },
        ...historyRes.rows.map(
          (m: { role: string; content: string }) =>
            ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }) as OpenAI.Chat.Completions.ChatCompletionMessageParam
        ),
      ]

    // Call OpenAI — NON-STREAMING for maximum reliability
    const openai = new OpenAI({ apiKey })
    const completion = await openai.chat.completions.create({
      model: aiModel,
      messages: openaiMessages,
      temperature: 0.7,
      max_tokens: 1024,
    })

    const reply =
      completion.choices[0]?.message?.content ||
      "Sorry, I couldn't generate a response. Please try again."

    // Save assistant message
    const saveNow = new Date().toISOString()
    await pool.query(
      'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      [cuid(), convoId, "assistant", reply, saveNow]
    )
    await pool.query('UPDATE "Conversation" SET "updatedAt" = $1 WHERE id = $2', [
      saveNow,
      convoId,
    ])

    // Send reply to Telegram — THIS MUST COMPLETE before we return
    const sendResult = await tgSend(chatId, reply, botToken, messageId)

    if (!sendResult.ok) {
      // If reply-to failed, try without reply
      await tgSend(chatId, reply, botToken)
    }
  } catch (err) {
    console.error(
      "[TG] Error:",
      err instanceof Error ? err.message : String(err)
    )
    // Best-effort error message to user
    try {
      await tgSend(chatId, "Sorry, something went wrong. Please try again.")
    } catch {}
  }

  return NextResponse.json({ ok: true })
}

// ── Telegram Bot API helper ──────────────────────────────────────────

async function tgSend(
  chatId: string,
  text: string,
  botToken?: string,
  replyToMessageId?: number
): Promise<{ ok: boolean; [key: string]: unknown }> {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, error: "no token" }

  // Telegram limit is 4096 chars — split if needed
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.slice(i, i + 4000))
  }

  let lastResult: { ok: boolean; [key: string]: unknown } = { ok: false }

  for (let idx = 0; idx < chunks.length; idx++) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[idx],
    }

    // Only reply to original message for the first chunk
    if (replyToMessageId && idx === 0) {
      body.reply_parameters = {
        message_id: replyToMessageId,
        allow_sending_without_reply: true,
      }
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    )

    lastResult = (await res.json()) as { ok: boolean; [key: string]: unknown }

    if (!lastResult.ok) {
      console.error("[TG] sendMessage failed:", JSON.stringify(lastResult))
    }
  }

  return lastResult
}
