import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { pool, cuid } from "@/lib/db"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = (session.user as { id: string }).id
  const now = new Date().toISOString()

  // Default to personal mode for WhatsApp QR connect
  let connectionMode = "personal"
  try {
    const body = await req.json()
    if (body.connectionMode) connectionMode = body.connectionMode
  } catch {
    // No body is fine — default to personal
  }

  // Upsert WhatsApp channel as enabled with Baileys mode (no accessToken = Baileys)
  const existing = await pool.query(
    'SELECT id FROM "UserChannel" WHERE "userId" = $1 AND "channelType" = $2 AND "connectionMode" = $3',
    [userId, "whatsapp", connectionMode]
  )

  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE "UserChannel" SET config = $1, enabled = true, status = $2, "updatedAt" = $3 WHERE id = $4',
      [JSON.stringify({ mode: "baileys" }), "connecting", now, existing.rows[0].id]
    )
  } else {
    const id = cuid()
    await pool.query(
      'INSERT INTO "UserChannel" (id, "userId", "channelType", "connectionMode", config, enabled, status, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, userId, "whatsapp", connectionMode, JSON.stringify({ mode: "baileys" }), true, "connecting", now, now]
    )
  }

  // Clear old auth state + events to force fresh QR scan
  await pool.query("DELETE FROM baileys_auth WHERE user_id = $1", [userId])
  await pool.query(
    "DELETE FROM channel_events WHERE user_id = $1 AND channel_type = 'whatsapp'",
    [userId]
  )

  // Write a "connecting" event so the dashboard knows we're starting
  await pool.query(
    "INSERT INTO channel_events (id, user_id, channel_type, event_type, payload, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
    [cuid(), userId, "whatsapp", "connecting", null]
  )

  return NextResponse.json({ ok: true, status: "connecting" })
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = (session.user as { id: string }).id

  // Clear Baileys auth state
  await pool.query("DELETE FROM baileys_auth WHERE user_id = $1", [userId])

  // Clear channel events
  await pool.query(
    "DELETE FROM channel_events WHERE user_id = $1 AND channel_type = 'whatsapp'",
    [userId]
  )

  // Disable both business and personal WhatsApp channels
  await pool.query(
    'UPDATE "UserChannel" SET enabled = false, status = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "channelType" = $3',
    ["disconnected", userId, "whatsapp"]
  )

  return NextResponse.json({ ok: true, status: "disconnected" })
}
