import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { pool } from "@/lib/db"

/** Register/unregister the Telegram webhook */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { action } = await req.json()

  // Get the user's Telegram channel config
  const channelRes = await pool.query(
    'SELECT config FROM "UserChannel" WHERE "userId" = $1 AND "channelType" = $2',
    [session.user.id, "telegram"]
  )

  if (channelRes.rows.length === 0) {
    return NextResponse.json({ error: "Telegram channel not configured" }, { status: 400 })
  }

  let config: Record<string, string> = {}
  try {
    config = typeof channelRes.rows[0].config === "string"
      ? JSON.parse(channelRes.rows[0].config)
      : channelRes.rows[0].config
  } catch {
    return NextResponse.json({ error: "Invalid channel config" }, { status: 400 })
  }

  const botToken = config.botToken
  if (!botToken) {
    return NextResponse.json({ error: "No bot token found in config" }, { status: 400 })
  }

  // Determine the webhook URL
  const baseUrl = process.env.NEXTAUTH_URL || req.headers.get("origin") || ""
  const webhookUrl = `${baseUrl}/api/webhooks/telegram`

  if (action === "unregister") {
    // Remove webhook
    const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
      method: "POST",
    })
    const data = await res.json()
    return NextResponse.json({ ok: data.ok, action: "unregistered" })
  }

  // Register webhook
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message", "edited_message"],
    }),
  })
  const data = await res.json()

  if (data.ok) {
    // Update channel status
    await pool.query(
      'UPDATE "UserChannel" SET status = $1 WHERE "userId" = $2 AND "channelType" = $3',
      ["connected", session.user.id, "telegram"]
    )
  }

  // Also get bot info
  const botInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
  const botInfo = await botInfoRes.json()

  return NextResponse.json({
    ok: data.ok,
    description: data.description,
    webhookUrl,
    botUsername: botInfo.result?.username,
  })
}

/** Check webhook status */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const channelRes = await pool.query(
    'SELECT config FROM "UserChannel" WHERE "userId" = $1 AND "channelType" = $2',
    [session.user.id, "telegram"]
  )

  if (channelRes.rows.length === 0) {
    return NextResponse.json({ registered: false })
  }

  let config: Record<string, string> = {}
  try {
    config = typeof channelRes.rows[0].config === "string"
      ? JSON.parse(channelRes.rows[0].config)
      : channelRes.rows[0].config
  } catch {
    return NextResponse.json({ registered: false })
  }

  const botToken = config.botToken
  if (!botToken) {
    return NextResponse.json({ registered: false })
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`)
  const data = await res.json()

  return NextResponse.json({
    registered: !!data.result?.url,
    url: data.result?.url,
    pendingUpdateCount: data.result?.pending_update_count,
    lastErrorDate: data.result?.last_error_date,
    lastErrorMessage: data.result?.last_error_message,
  })
}
