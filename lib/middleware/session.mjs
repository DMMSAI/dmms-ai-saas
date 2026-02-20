/**
 * DMMS AI — Session Middleware
 * Looks up or creates a Conversation row for the incoming message.
 * Sets ctx.convoId, ctx.aiProvider, ctx.aiModel on the context.
 */

import { randomBytes } from "crypto"

const cuid = () => "c" + randomBytes(12).toString("hex")

/**
 * @param {import("pg").Pool} pool
 */
export function sessionMiddleware(pool) {
  return async function session(ctx, next) {
    const convoRes = await pool.query(
      'SELECT id, "aiModel", "aiProvider" FROM "Conversation" WHERE "userId" = $1 AND "channelType" = $2 AND "channelPeer" = $3 ORDER BY "updatedAt" DESC LIMIT 1',
      [ctx.userId, ctx.channelType, ctx.channelPeer]
    )

    ctx.now = new Date().toISOString()

    if (convoRes.rows.length > 0) {
      const row = convoRes.rows[0]
      ctx.convoId = row.id
      ctx.aiModel = row.aiModel || "gpt-5.2-chat-latest"
      ctx.aiProvider = row.aiProvider || "openai"
    } else {
      ctx.convoId = cuid()
      ctx.aiModel = "gpt-5.2-chat-latest"
      ctx.aiProvider = "openai"
      await pool.query(
        'INSERT INTO "Conversation" (id, "userId", "channelType", "channelPeer", title, "aiModel", "aiProvider", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [ctx.convoId, ctx.userId, ctx.channelType, ctx.channelPeer, ctx.text.slice(0, 50), ctx.aiModel, ctx.aiProvider, ctx.now, ctx.now]
      )
    }

    await next()
  }
}
