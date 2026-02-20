import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { pool, cuid } from "@/lib/db"

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = (session.user as { id: string }).id
  const now = new Date().toISOString()
  const connectionMode = "personal"

  // Upsert WeChat channel as enabled with Wechaty mode
  const existing = await pool.query(
    'SELECT id FROM "UserChannel" WHERE "userId" = $1 AND "channelType" = $2 AND "connectionMode" = $3',
    [userId, "wechat", connectionMode]
  )

  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE "UserChannel" SET config = $1, enabled = true, status = $2, "updatedAt" = $3 WHERE id = $4',
      [JSON.stringify({ mode: "wechaty" }), "connecting", now, existing.rows[0].id]
    )
  } else {
    const id = cuid()
    await pool.query(
      'INSERT INTO "UserChannel" (id, "userId", "channelType", "connectionMode", config, enabled, status, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, userId, "wechat", connectionMode, JSON.stringify({ mode: "wechaty" }), true, "connecting", now, now]
    )
  }

  // Clear old events to force fresh QR scan
  await pool.query(
    "DELETE FROM channel_events WHERE user_id = $1 AND channel_type = 'wechat'",
    [userId]
  )

  // Write a "connecting" event
  await pool.query(
    "INSERT INTO channel_events (id, user_id, channel_type, event_type, payload, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
    [cuid(), userId, "wechat", "connecting", null]
  )

  return NextResponse.json({ ok: true, status: "connecting" })
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = (session.user as { id: string }).id

  // Clear channel events
  await pool.query(
    "DELETE FROM channel_events WHERE user_id = $1 AND channel_type = 'wechat'",
    [userId]
  )

  // Disable WeChat channels
  await pool.query(
    'UPDATE "UserChannel" SET enabled = false, status = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "channelType" = $3',
    ["disconnected", userId, "wechat"]
  )

  return NextResponse.json({ ok: true, status: "disconnected" })
}
