/**
 * DMMS AI — AI Router Middleware
 * Calls the appropriate AI provider and sets ctx.reply.
 */

import { callAI } from "../ai/registry.mjs"

/**
 * Build system prompt for the AI.
 */
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

/**
 * @param {import("pg").Pool} pool - For looking up API keys
 */
export function aiRouterMiddleware(pool) {
  return async function aiRouter(ctx, next) {
    // Resolve API key for the provider
    const provider = ctx.aiProvider || "openai"
    const keyRes = await pool.query(
      'SELECT "apiKey" FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
      [ctx.userId, provider]
    )

    const envKeyMap = {
      openai: "OPENAI_API_KEY",
      gemini: "GEMINI_API_KEY",
    }
    const apiKey = keyRes.rows[0]?.apiKey || process.env[envKeyMap[provider] || "OPENAI_API_KEY"]
    if (!apiKey) throw new Error(`No API key configured for ${provider}`)

    // Build messages array
    const messages = [
      { role: "system", content: buildSystemPrompt(ctx.channelName || ctx.channelType) },
      ...ctx.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: ctx.text },
    ]

    ctx.toolsUsed = ctx.toolsUsed || []

    const startTime = Date.now()
    const result = await callAI(provider, apiKey, messages, ctx.aiModel, {
      onTyping: ctx.onTyping,
    })

    ctx.reply = result.reply
    ctx.toolsUsed.push(...result.toolsUsed)

    const elapsed = Date.now() - startTime
    console.log(
      `[MW:AI] Response ready (${elapsed}ms, provider: ${provider}${ctx.toolsUsed.length > 0 ? ", tools: " + ctx.toolsUsed.join(", ") : ""})`
    )

    await next()
  }
}
