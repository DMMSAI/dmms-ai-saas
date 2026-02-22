import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { pool } from "@/lib/db"

const VALID_PROVIDERS = ["openai", "gemini", "anthropic"]

const VALID_MODELS: Record<string, string[]> = {
  openai: ["gpt-5.2-chat-latest", "gpt-4o", "gpt-4o-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6"],
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Read from User table columns (defaultAiProvider, defaultAiModel)
  const result = await pool.query(
    'SELECT "defaultAiProvider", "defaultAiModel" FROM "User" WHERE id = $1',
    [session.user.id]
  )

  const row = result.rows[0]
  return NextResponse.json({
    aiProvider: row?.defaultAiProvider || "openai",
    aiModel: row?.defaultAiModel || "gpt-4o",
  })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { aiProvider, aiModel } = await req.json()

  if (!aiProvider || !VALID_PROVIDERS.includes(aiProvider)) {
    return NextResponse.json(
      { error: `Invalid provider. Supported: ${VALID_PROVIDERS.join(", ")}` },
      { status: 400 }
    )
  }

  if (!aiModel || !VALID_MODELS[aiProvider]?.includes(aiModel)) {
    return NextResponse.json(
      { error: `Invalid model for ${aiProvider}. Supported: ${VALID_MODELS[aiProvider]?.join(", ")}` },
      { status: 400 }
    )
  }

  await pool.query(
    'UPDATE "User" SET "defaultAiProvider" = $1, "defaultAiModel" = $2 WHERE id = $3',
    [aiProvider, aiModel, session.user.id]
  )

  return NextResponse.json({ ok: true })
}
