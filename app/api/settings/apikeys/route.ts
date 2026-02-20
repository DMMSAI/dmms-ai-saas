import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { pool, cuid } from "@/lib/db"

const VALID_PROVIDERS = ["openai", "gemini"]

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await pool.query(
    'SELECT provider FROM "UserApiKey" WHERE "userId" = $1',
    [session.user.id]
  )

  const keys: Record<string, boolean> = {}
  for (const row of result.rows) keys[row.provider] = true

  return NextResponse.json(keys)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { provider, apiKey } = await req.json()
  if (!provider || !apiKey) {
    return NextResponse.json({ error: "provider and apiKey required" }, { status: 400 })
  }

  if (!VALID_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: `Invalid provider. Supported: ${VALID_PROVIDERS.join(", ")}` }, { status: 400 })
  }

  const existing = await pool.query(
    'SELECT id FROM "UserApiKey" WHERE "userId" = $1 AND provider = $2',
    [session.user.id, provider]
  )

  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE "UserApiKey" SET "apiKey" = $1 WHERE id = $2',
      [apiKey, existing.rows[0].id]
    )
  } else {
    const id = cuid()
    const now = new Date().toISOString()
    await pool.query(
      'INSERT INTO "UserApiKey" (id, "userId", provider, "apiKey", "isDefault", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [id, session.user.id, provider, apiKey, true, now]
    )
  }

  return NextResponse.json({ ok: true })
}
