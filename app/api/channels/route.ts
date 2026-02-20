import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { pool, cuid } from "@/lib/db"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await pool.query(
    'SELECT * FROM "UserChannel" WHERE "userId" = $1 ORDER BY "channelType"',
    [session.user.id]
  )

  return NextResponse.json(result.rows)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { channelType, config, enabled, connectionMode } = await req.json()
  if (!channelType) {
    return NextResponse.json({ error: "channelType required" }, { status: 400 })
  }

  const mode = connectionMode || "business"
  const now = new Date().toISOString()
  const configStr = JSON.stringify(config || {})

  const existing = await pool.query(
    'SELECT id FROM "UserChannel" WHERE "userId" = $1 AND "channelType" = $2 AND "connectionMode" = $3',
    [session.user.id, channelType, mode]
  )

  let channel
  if (existing.rows.length > 0) {
    const res = await pool.query(
      'UPDATE "UserChannel" SET config = $1, enabled = $2, "updatedAt" = $3 WHERE id = $4 RETURNING *',
      [configStr, enabled ?? false, now, existing.rows[0].id]
    )
    channel = res.rows[0]
  } else {
    const id = cuid()
    const res = await pool.query(
      'INSERT INTO "UserChannel" (id, "userId", "channelType", "connectionMode", config, enabled, status, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [id, session.user.id, channelType, mode, configStr, enabled ?? false, "disconnected", now, now]
    )
    channel = res.rows[0]
  }

  return NextResponse.json(channel)
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { channelType, connectionMode } = await req.json()
  if (!channelType) {
    return NextResponse.json({ error: "channelType required" }, { status: 400 })
  }

  const mode = connectionMode || "business"

  await pool.query(
    'DELETE FROM "UserChannel" WHERE "userId" = $1 AND "channelType" = $2 AND "connectionMode" = $3',
    [session.user.id, channelType, mode]
  )

  return NextResponse.json({ ok: true })
}
