/**
 * DMMS AI — WhatsApp Connector (Baileys — QR Code Scan)
 * Personal mode: QR code scanning via Baileys (WhatsApp Web protocol).
 * Uses PostgreSQL auth state adapter for ephemeral hosting.
 */

import { makeWASocket, DisconnectReason } from "@whiskeysockets/baileys"
import { Boom } from "@hapi/boom"
import { usePgAuthState } from "../baileys-auth-pg.mjs"
import { BaseConnector } from "./base.mjs"

export class WhatsAppConnector extends BaseConnector {
  constructor(userId, config, pool) {
    super(userId, "whatsapp", "personal", config, pool)
    this._sock = null
    this._connecting = false
    this._retryCount = 0
  }

  async start() {
    if (this.config?.accessToken) {
      console.log("[WA] WhatsApp Business API mode detected — using webhook, not Baileys")
      return
    }

    console.log(`[WA] Starting WhatsApp (Baileys) for user ${this.userId.slice(0, 8)}...`)
    this._connecting = true
    await this._connect()
  }

  async stop() {
    this._running = false
    this._connecting = false
    if (this._sock) {
      this._sock.end()
      this._sock = null
    }
  }

  async send(jid, text) {
    if (!this._sock) throw new Error("WhatsApp not connected")

    const chunks = []
    for (let i = 0; i < text.length; i += 4000) {
      chunks.push(text.slice(i, i + 4000))
    }
    for (const chunk of chunks) {
      await this._sock.sendMessage(jid, { text: chunk })
    }
  }

  get socket() {
    return this._sock
  }

  get isConnecting() {
    return this._connecting
  }

  get permanentlyFailed() {
    return this._permanentlyFailed === true
  }

  async _connect() {
    try {
      const { state, saveCreds } = await usePgAuthState(
        process.env.DATABASE_URL,
        this.userId
      )

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["DMMS AI", "Chrome", "1.0.0"],
        connectTimeoutMs: 60000,
        syncFullHistory: false,
      })

      this._sock = sock
      this._running = true

      // Handle connection updates
      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          console.log("[WA] QR code received — writing to channel_events")
          await this.writeEvent("qr", qr)
        }

        if (connection === "close") {
          this._sock = null
          const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode

          console.log(`[WA] Connection closed (code: ${statusCode})`)
          await this.writeEvent("disconnected", String(statusCode))
          await this.updateStatus("disconnected")

          if (statusCode === DisconnectReason.loggedOut) {
            console.log("[WA] Logged out — clearing auth state")
            await this.pool.query("DELETE FROM baileys_auth WHERE user_id = $1", [this.userId])
            await this.writeEvent("logged_out", null)
            this._connecting = false
          } else if (statusCode === 440) {
            // Conflict: another WhatsApp Web session replaced us.
            // This commonly happens during deploys when the old instance is still alive.
            // Keep _connecting = true so registry won't restart us during the wait.
            if (!this._conflictRetried) {
              this._conflictRetried = true
              this._connecting = true  // Keep true so registry stale check doesn't interfere
              console.log("[WA] Conflict detected (deploy overlap) — waiting 15s then retrying...")
              setTimeout(() => this._connect(), 15000)
            } else {
              console.log("[WA] Conflict persists — another WhatsApp Web session is active. Close other sessions and reconnect from dashboard.")
              this._connecting = false
              this._permanentlyFailed = true
              await this.writeEvent("error", "Another WhatsApp Web session is active. Close it and reconnect.")
            }
          } else if (this._retryCount < 5) {
            const delay = Math.min(3000 * Math.pow(2, this._retryCount), 30000)
            this._retryCount++
            console.log(`[WA] Reconnecting in ${delay / 1000}s (attempt ${this._retryCount})...`)
            setTimeout(() => this._connect(), delay)
          } else {
            console.log("[WA] Max retries reached — stopping")
            this._connecting = false
          }
        }

        if (connection === "open") {
          console.log("[WA] Connected successfully!")
          this._retryCount = 0
          this._connecting = false
          await this.writeEvent("connected", null)
          await this.updateStatus("connected")
        }
      })

      // Handle credential updates
      sock.ev.on("creds.update", saveCreds)

      // Handle incoming messages
      sock.ev.on("messages.upsert", async (upsert) => {
        const msgs = upsert.messages || upsert
        const type = upsert.type || "notify"

        if (type !== "notify") return

        for (const msg of msgs) {
          if (msg.key.fromMe) continue

          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            ""

          if (!text.trim()) continue

          const jid = msg.key.remoteJid
          const pushName = msg.pushName || "User"
          const peer = jid.replace(/@s\.whatsapp\.net$/, "")

          console.log(`[WA:Receive] From ${pushName} (${peer}): "${text.slice(0, 60)}"`)

          try {
            const reply = await this.handleMessage(peer, text.trim(), {
              channelName: "WhatsApp",
              onTyping: () => {
                sock.sendPresenceUpdate("composing", jid).catch(() => {})
              },
            })

            await this.send(jid, reply)
            sock.sendPresenceUpdate("available", jid).catch(() => {})

            const preview = (s) => (s || "").slice(0, 50).replace(/\n/g, " ")
            console.log(`[WA] ${pushName}: "${preview(text)}" → "${preview(reply)}"`)
          } catch (err) {
            console.error("[WA] Pipeline error:", err.message)
            await sock.sendMessage(jid, { text: "Sorry, something went wrong. Please try again." }).catch(() => {})
          }
        }
      })
    } catch (err) {
      this._connecting = false
      console.error("[WA] Fatal error:", err.message)
      if (this._retryCount < 5) {
        const delay = Math.min(3000 * Math.pow(2, this._retryCount), 30000)
        this._retryCount++
        console.log(`[WA] Retrying in ${delay / 1000}s...`)
        setTimeout(() => this._connect(), delay)
      }
    }
  }
}
