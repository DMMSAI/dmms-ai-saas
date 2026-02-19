/**
 * Next.js Instrumentation Hook
 *
 * Called once when the Next.js server starts.
 * Starts the Telegram bot with long-polling.
 */
export async function register() {
  // Skip if we're in Edge runtime (only relevant on Vercel)
  if (process.env.NEXT_RUNTIME === "edge") return

  console.log("[Instrumentation] register() called")

  try {
    const { startTelegramBot } = await import("./lib/telegram-bot")
    startTelegramBot()
  } catch (err) {
    console.error("[Instrumentation] Failed to start bot:", err)
  }
}
