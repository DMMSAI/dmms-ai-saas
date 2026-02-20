/**
 * DMMS AI — History Middleware
 * Loads the last N messages from DB for the conversation.
 * Sets ctx.history (array of {role, content}).
 */

/**
 * @param {import("pg").Pool} pool
 * @param {number} limit - Max messages to load (default 10)
 */
export function historyMiddleware(pool, limit = 10) {
  return async function history(ctx, next) {
    const historyRes = await pool.query(
      'SELECT role, content FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" DESC LIMIT $2',
      [ctx.convoId, limit]
    )
    ctx.history = historyRes.rows.reverse()

    await next()
  }
}
