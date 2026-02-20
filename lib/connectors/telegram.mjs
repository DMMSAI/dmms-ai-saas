/**
 * DMMS AI — Telegram Connector
 * Long-polling via Telegram Bot API.
 */

import { BaseConnector } from "./base.mjs"

export class TelegramConnector extends BaseConnector {
  constructor(userId, config, pool) {
    super(userId, "telegram", "business", config, pool)
    this._token = config.botToken
    this._offset = 0
    this._abortController = null
  }

  _url(method) {
    return `https://api.telegram.org/bot${this._token}/${method}`
  }

  async start() {
    if (!this._token) {
      console.log("[TG] No bot token — skipping")
      return
    }

    // Delete webhook (can't use both)
    await fetch(this._url("deleteWebhook"), { method: "POST" }).catch(() => {})

    // Verify token
    const me = await fetch(this._url("getMe"))
    const meData = await me.json()
    if (!meData.ok) {
      console.error("[TG] Invalid token:", meData.description)
      return
    }

    console.log(`[TG] Connected as @${meData.result.username}`)
    await this.writeEvent("connected", meData.result.username)
    await this.updateStatus("connected")

    this._running = true
    this._pollLoop()
  }

  async stop() {
    this._running = false
    if (this._abortController) {
      this._abortController.abort()
      this._abortController = null
    }
  }

  async send(chatId, text, replyToId) {
    const chunks = []
    for (let i = 0; i < text.length; i += 4000) {
      chunks.push(text.slice(i, i + 4000))
    }

    for (let i = 0; i < chunks.length; i++) {
      const body = { chat_id: chatId, text: chunks[i] }
      if (replyToId && i === 0) {
        body.reply_parameters = { message_id: replyToId, allow_sending_without_reply: true }
      }

      const res = await fetch(this._url("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.ok) {
        console.error("[TG] Send failed:", data.description)
        if (replyToId && i === 0) {
          await fetch(this._url("sendMessage"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: chunks[i] }),
          })
        }
      }
    }
  }

  _sendTyping(chatId) {
    fetch(this._url("sendChatAction"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    }).catch(() => {})
  }

  async _pollLoop() {
    while (this._running) {
      try {
        this._abortController = new AbortController()
        const url = `${this._url("getUpdates")}?offset=${this._offset}&timeout=25&allowed_updates=${encodeURIComponent('["message","edited_message"]')}`
        const res = await fetch(url, { signal: AbortSignal.timeout(35000) })
        const data = await res.json()

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this._offset = update.update_id + 1
            const msg = update.message || update.edited_message
            if (!msg?.text) continue

            if (msg.text === "/start") {
              await this.send(
                String(msg.chat.id),
                "Welcome to DMMS AI! I'm your smart AI assistant.\n\nI can answer questions, search the web, give you news, weather, and more.\n\nJust send me any message!\n\nCommands:\n/new — Start a fresh conversation\n\nPowered by DMMS AI — Every Messenger is AI Now."
              )
              continue
            }

            if (msg.text === "/new") {
              await this.send(String(msg.chat.id), "Fresh start! Send me anything.")
              continue
            }

            const chatId = String(msg.chat.id)
            this._sendTyping(chatId)

            this._processMessage(msg).catch((err) => {
              console.error("[TG] Unhandled:", err.message)
            })
          }
        }
      } catch (err) {
        if (err.name !== "AbortError" && err.name !== "TimeoutError") {
          console.error("[TG] Poll error:", err.message)
        }
        if (this._running) await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }

  async _processMessage(msg) {
    const chatId = String(msg.chat.id)
    const text = (msg.text || "").trim()
    if (!text) return

    console.log(`[TG:Receive] From ${msg.from?.first_name || "User"} (${chatId}): "${text.slice(0, 60)}"`)

    try {
      const reply = await this.handleMessage(chatId, text, {
        channelName: "Telegram",
        onTyping: () => this._sendTyping(chatId),
      })
      await this.send(chatId, reply, msg.message_id)

      const preview = (s) => (s || "").slice(0, 50).replace(/\n/g, " ")
      console.log(`[TG] ${msg.from?.first_name}: "${preview(text)}" → "${preview(reply)}"`)
    } catch (err) {
      console.error("[TG] Pipeline error:", err.message)
      await this.send(chatId, "Sorry, something went wrong. Please try again.").catch(() => {})
    }
  }
}
