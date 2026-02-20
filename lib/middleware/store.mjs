/**
 * DMMS AI — Store Middleware
 * Saves user message + AI response to the Message table.
 */

import { randomBytes } from "crypto"

const cuid = () => "c" + randomBytes(12).toString("hex")

/**
 * @param {import("pg").Pool} pool
 */
export function storeMiddleware(pool) {
  return async function store(ctx, next) {
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

    await next()
  }
}
