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

  // Upsert Signal channel as enabled
  let existing = await pool.query(
    'SELECT id FROM "UserChannel" WHERE "userId" = $1 AND "channelType" = $2 AND "connectionMode" = $3',
    [userId, "signal", connectionMode]
  )

  if (existing.rows.length === 0) {
    existing = await pool.query(
      'SELECT id FROM "UserChannel" WHERE "userId" = $1 AND "channelType" = $2',
      [userId, "signal"]
    )
  }

  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE "UserChannel" SET config = $1, enabled = true, status = $2, "connectionMode" = $3, "updatedAt" = $4 WHERE id = $5',
      [JSON.stringify({ mode: "signal-cli" }), "connecting", connectionMode, now, existing.rows[0].id]
    )
  } else {
    const id = cuid()
    await pool.query(
      'INSERT INTO "UserChannel" (id, "userId", "channelType", "connectionMode", config, enabled, status, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, userId, "signal", connectionMode, JSON.stringify({ mode: "signal-cli" }), true, "connecting", now, now]
    )
  }

  // Check if a QR code already exists (connector may have started at boot)
  const existingQr = await pool.query(
    "SELECT payload FROM channel_events WHERE user_id = $1 AND channel_type = 'signal' AND event_type = 'qr' ORDER BY created_at DESC LIMIT 1",
    [userId]
  )

  if (existingQr.rows.length > 0 && existingQr.rows[0].payload) {
    return NextResponse.json({ ok: true, status: "connecting" })
  }

  // Clear old events and write connecting
  await pool.query(
    "DELETE FROM channel_events WHERE user_id = $1 AND channel_type = 'signal'",
    [userId]
  )

  await pool.query(
    "INSERT INTO channel_events (id, user_id, channel_type, event_type, payload, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
    [cuid(), userId, "signal", "connecting", null]
  )

  return NextResponse.json({ ok: true, status: "connecting" })
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = (session.user as { id: string }).id

  await pool.query(
    "DELETE FROM channel_events WHERE user_id = $1 AND channel_type = 'signal'",
    [userId]
  )

  await pool.query(
    'UPDATE "UserChannel" SET enabled = false, status = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "channelType" = $3',
    ["disconnected", userId, "signal"]
  )

  return NextResponse.json({ ok: true, status: "disconnected" })
}
