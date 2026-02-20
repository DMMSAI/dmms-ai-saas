/**
 * DMMS AI — WeChat Connector (Wechaty — QR Code Scan)
 * Personal mode: QR code scanning via Wechaty (WeChat Web/iPad protocol).
 * Same flow as WhatsApp/Baileys: scan QR → connected → AI responds to messages.
 *
 * Supports multiple puppets:
 *   - wechaty-puppet-wechat4u (free, web protocol — may be blocked for some accounts)
 *   - wechaty-puppet-padlocal (paid, iPad protocol — most reliable, ~$20/month)
 *   - wechaty-puppet-service (cloud puppet service)
 *
 * Default: wechaty-puppet-wechat4u (free, works out of the box)
 */

import { BaseConnector } from "./base.mjs"

export class WeChatConnector extends BaseConnector {
  constructor(userId, config, pool) {
    super(userId, "wechat", "personal", config, pool)
    this._bot = null
    this._retryCount = 0
    this._connecting = false
  }

  async start() {
    // If config has appId/appSecret, it's Official Account API mode — skip Wechaty
    if (this.config?.appId && this.config?.appSecret) {
      console.log("[WeChat] Official Account API mode detected — using webhook, not Wechaty")
      return
    }

    console.log(`[WeChat] Starting WeChat (Wechaty) for user ${this.userId.slice(0, 8)}...`)
    this._connecting = true
    await this._connect()
  }

  async stop() {
    this._running = false
    this._connecting = false
    if (this._bot) {
      try {
        await this._bot.stop()
      } catch {
        // Ignore stop errors
      }
      this._bot = null
    }
  }

  async send(contactId, text) {
    if (!this._bot || !this._bot.isLoggedIn) throw new Error("WeChat not connected")

    // Split long messages (WeChat limit: ~2048 chars for text)
    const chunks = []
    for (let i = 0; i < text.length; i += 2000) {
      chunks.push(text.slice(i, i + 2000))
    }

    // Find the contact/room and send
    const contact = await this._bot.Contact.find({ id: contactId }).catch(() => null)
    if (contact) {
      for (const chunk of chunks) {
        await contact.say(chunk)
      }
      return
    }

    // Try as room
    const room = await this._bot.Room.find({ id: contactId }).catch(() => null)
    if (room) {
      for (const chunk of chunks) {
        await room.say(chunk)
      }
      return
    }

    throw new Error(`Contact/Room not found: ${contactId}`)
  }

  get isConnecting() {
    return this._connecting
  }

  get socket() {
    return this._bot?.isLoggedIn ? this._bot : null
  }

  async _connect() {
    try {
      const { WechatyBuilder } = await import("wechaty")

      // Determine puppet based on config
      let puppetOptions = {}
      if (this.config?.padlocalToken) {
        // PadLocal puppet (paid, most reliable)
        puppetOptions = {
          puppet: "wechaty-puppet-padlocal",
          puppetOptions: { token: this.config.padlocalToken },
        }
        console.log("[WeChat] Using PadLocal puppet (iPad protocol)")
      } else {
        // Free web puppet (wechat4u)
        puppetOptions = {
          puppet: "wechaty-puppet-wechat4u",
        }
        console.log("[WeChat] Using wechat4u puppet (web protocol)")
      }

      const bot = WechatyBuilder.build({
        name: `dmms-wechat-${this.userId.slice(0, 8)}`,
        ...puppetOptions,
      })

      this._bot = bot

      // ── QR Code Event ──────────────────────────────────────────
      bot.on("scan", async (qrcode, status) => {
        // Status 2 = waiting for scan, 3 = scanned waiting for confirm
        console.log(`[WeChat] QR code received (status: ${status})`)

        if (qrcode) {
          // Write QR string to channel_events (dashboard will render it)
          await this.writeEvent("qr", qrcode)
        }
      })

      // ── Login Event ────────────────────────────────────────────
      bot.on("login", async (user) => {
        console.log(`[WeChat] Connected as ${user.name()}`)
        this._connecting = false
        this._retryCount = 0
        this._running = true
        await this.writeEvent("connected", user.name())
        await this.updateStatus("connected")
      })

      // ── Logout Event ───────────────────────────────────────────
      bot.on("logout", async (user, reason) => {
        console.log(`[WeChat] Logged out: ${user.name()} — ${reason || "unknown reason"}`)
        this._running = false
        await this.writeEvent("disconnected", reason || "logged_out")
        await this.updateStatus("disconnected")

        // Retry with backoff
        if (this._retryCount < 3) {
          const delay = Math.min(5000 * Math.pow(2, this._retryCount), 30000)
          this._retryCount++
          console.log(`[WeChat] Reconnecting in ${delay / 1000}s (attempt ${this._retryCount})...`)
          this._connecting = true
          setTimeout(() => this._connect(), delay)
        } else {
          this._connecting = false
          console.log("[WeChat] Max retries reached — stopping")
        }
      })

      // ── Error Event ────────────────────────────────────────────
      bot.on("error", async (error) => {
        console.error("[WeChat] Error:", error.message)
        await this.writeEvent("error", error.message).catch(() => {})
      })

      // ── Message Event ──────────────────────────────────────────
      bot.on("message", async (message) => {
        // Skip self messages
        if (message.self()) return

        // Only handle text messages
        const type = message.type()
        const { Message } = await import("wechaty")
        if (type !== Message.Type.Text) return

        const text = message.text()?.trim()
        if (!text) return

        const talker = message.talker()
        const room = message.room()

        // Build peer identifier
        let peerId
        let peerName
        if (room) {
          peerId = `room:${room.id}:${talker.id}`
          const topic = await room.topic().catch(() => "Group")
          peerName = `${talker.name()} in ${topic}`
        } else {
          peerId = talker.id
          peerName = talker.name()
        }

        console.log(`[WeChat:Receive] From ${peerName}: "${text.slice(0, 60)}"`)

        try {
          const reply = await this.handleMessage(peerId, text, {
            channelName: "WeChat",
            onTyping: () => {}, // WeChat doesn't have typing indicators
          })

          // Send reply
          if (room) {
            await room.say(reply)
          } else {
            await talker.say(reply)
          }

          const preview = (s) => (s || "").slice(0, 50).replace(/\n/g, " ")
          console.log(`[WeChat] ${peerName}: "${preview(text)}" → "${preview(reply)}"`)
        } catch (err) {
          console.error("[WeChat] Pipeline error:", err.message)
          try {
            if (room) {
              await room.say("Sorry, something went wrong. Please try again.")
            } else {
              await talker.say("Sorry, something went wrong. Please try again.")
            }
          } catch {
            // Ignore send errors
          }
        }
      })

      // ── Start the bot ──────────────────────────────────────────
      console.log("[WeChat] Starting Wechaty bot...")
      await bot.start()
      console.log("[WeChat] Wechaty bot started — waiting for QR scan")

    } catch (err) {
      this._connecting = false
      console.error("[WeChat] Fatal error:", err.message)

      if (this._retryCount < 3) {
        const delay = Math.min(5000 * Math.pow(2, this._retryCount), 30000)
        this._retryCount++
        console.log(`[WeChat] Retrying in ${delay / 1000}s...`)
        setTimeout(() => this._connect(), delay)
      }
    }
  }
}
