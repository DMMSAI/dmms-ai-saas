import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { pool } from "@/lib/db"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = (session.user as { id: string }).id

  // Get latest status event
  const res = await pool.query(
    `SELECT event_type, payload, created_at FROM channel_events
     WHERE user_id = $1 AND channel_type = 'whatsapp'
     AND event_type IN ('connected', 'disconnected', 'logged_out', 'error', 'connecting')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )

  if (res.rows.length === 0) {
    return NextResponse.json({ status: "not_configured" })
  }

  const event = res.rows[0]

  return NextResponse.json({
    status: event.event_type,
    payload: event.payload,
    timestamp: event.created_at,
  })
}
