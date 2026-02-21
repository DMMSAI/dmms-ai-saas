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

  // Check latest event for WeChat
  const connectedRes = await pool.query(
    `SELECT event_type, payload, created_at FROM channel_events
     WHERE user_id = $1 AND channel_type = 'wechat'
     AND event_type IN ('connected', 'qr', 'disconnected', 'logged_out', 'error')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )

  if (connectedRes.rows.length === 0) {
    // No QR/connected/error event yet — check if "connecting" event is too old (timeout)
    const connectingRes = await pool.query(
      `SELECT created_at FROM channel_events
       WHERE user_id = $1 AND channel_type = 'wechat' AND event_type = 'connecting'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    )

    if (connectingRes.rows.length > 0) {
      const age = Date.now() - new Date(connectingRes.rows[0].created_at).getTime()
      if (age > 30000) {
        return NextResponse.json({
          status: "error",
          error: "WeChat personal mode is not available yet. Coming soon!",
        })
      }
    }

    return NextResponse.json({ status: "waiting" })
  }

  const latest = connectedRes.rows[0]

  if (latest.event_type === "connected") {
    return NextResponse.json({ status: "connected" })
  }

  if (latest.event_type === "qr") {
    return NextResponse.json({ status: "qr", qr: latest.payload })
  }

  if (latest.event_type === "logged_out") {
    return NextResponse.json({ status: "logged_out" })
  }

  if (latest.event_type === "error") {
    return NextResponse.json({ status: "error", error: latest.payload })
  }

  return NextResponse.json({ status: "disconnected" })
}
