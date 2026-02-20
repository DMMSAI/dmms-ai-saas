import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { pool, cuid } from "@/lib/db"
import { ProviderManager } from "@/core/providers/manager"
import { ProviderMessage } from "@/core/providers/base"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { message, conversationId, model, aiProvider } = await req.json()
  if (!message?.trim()) {
    return NextResponse.json({ error: "Message required" }, { status: 400 })
  }

  // Resolve provider (default: openai)
  const provider = aiProvider || "openai"

  // Get user's API key for the selected provider
  const apiKeyRes = await pool.query(
    'SELECT "apiKey" FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
    [session.user.id, provider]
  )

  const envKeyMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  }
  const apiKey = apiKeyRes.rows[0]?.apiKey || process.env[envKeyMap[provider] || "OPENAI_API_KEY"]
  if (!apiKey) {
    return NextResponse.json(
      { error: `No ${provider} API key configured. Add one in Settings.` },
      { status: 400 }
    )
  }

  // Get or create conversation
  let convoId = conversationId
  let aiModel = model || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o")

  if (convoId) {
    const existing = await pool.query(
      'SELECT id, "aiModel", "aiProvider" FROM "Conversation" WHERE id = $1 AND "userId" = $2',
      [convoId, session.user.id]
    )
    if (existing.rows.length === 0) convoId = null
    else aiModel = model || existing.rows[0].aiModel
  }

  if (!convoId) {
    convoId = cuid()
    const now = new Date().toISOString()
    await pool.query(
      'INSERT INTO "Conversation" (id, "userId", "channelType", "channelPeer", title, "aiModel", "aiProvider", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [convoId, session.user.id, "web", "", message.slice(0, 50), aiModel, provider, now, now]
    )
  }

  // Save user message
  const userMsgId = cuid()
  const now = new Date().toISOString()
  await pool.query(
    'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
    [userMsgId, convoId, "user", message, now]
  )

  // Build context
  const messagesRes = await pool.query(
    'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" ASC LIMIT 50',
    [convoId]
  )

  const context: ProviderMessage[] = [
    { role: "system", content: "You are DMMS AI, a helpful AI assistant. You are knowledgeable, friendly, and concise." },
    ...messagesRes.rows.map((m) => ({ role: m.role as ProviderMessage["role"], content: m.content })),
  ]

  // Create provider — use existing OpenAI streaming for OpenAI, simple response for Gemini
  if (provider === "gemini") {
    // Gemini: non-streaming response (the AI layer handles tool loops)
    try {
      const { callGemini } = await import("@/lib/ai/gemini.mjs")
      const result = await callGemini(apiKey, context, aiModel)

      const fullResponse = result.reply

      // Save assistant message
      if (fullResponse) {
        const msgId = cuid()
        const saveNow = new Date().toISOString()
        await pool.query(
          'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
          [msgId, convoId, "assistant", fullResponse, saveNow]
        )
        await pool.query(
          'UPDATE "Conversation" SET "updatedAt" = $1 WHERE id = $2',
          [saveNow, convoId]
        )
      }

      // Return SSE-compatible response
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "text", content: fullResponse })}\n\n`)
          )
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
          )
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "end", conversationId: convoId })}\n\n`)
          )
          controller.close()
        },
      })

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Gemini error" },
        { status: 500 }
      )
    }
  }

  // OpenAI: streaming response (existing behavior)
  const pm = new ProviderManager()
  const openaiProvider = pm.getOrCreate("openai", { apiKey })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ""

      try {
        for await (const chunk of openaiProvider.chat(context, { model: aiModel })) {
          if (chunk.type === "text" && chunk.content) {
            fullResponse += chunk.content
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text", content: chunk.content })}\n\n`)
            )
          }
          if (chunk.type === "error") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", error: chunk.error })}\n\n`)
            )
            break
          }
          if (chunk.type === "done") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "done", usage: chunk.usage })}\n\n`)
            )
          }
        }

        // Save assistant message
        if (fullResponse) {
          const msgId = cuid()
          const saveNow = new Date().toISOString()
          await pool.query(
            'INSERT INTO "Message" (id, "conversationId", role, content, "createdAt") VALUES ($1, $2, $3, $4, $5)',
            [msgId, convoId, "assistant", fullResponse, saveNow]
          )
          await pool.query(
            'UPDATE "Conversation" SET "updatedAt" = $1 WHERE id = $2',
            [saveNow, convoId]
          )
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "end", conversationId: convoId })}\n\n`)
        )
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error: err instanceof Error ? err.message : "Unknown error" })}\n\n`)
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
