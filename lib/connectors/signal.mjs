/**
 * DMMS AI — Signal Connector (signal-cli-rest-api)
 * Personal mode: QR code scanning to link as a Signal secondary device.
 * Requires signal-cli-rest-api running as a separate service.
 *
 * Setup: Deploy bbernhard/signal-cli-rest-api Docker image and set
 * SIGNAL_CLI_API_URL env var (e.g. http://signal-cli:8080)
 */

import { BaseConnector } from "./base.mjs"

export class SignalConnector extends BaseConnector {
  constructor(userId, config, pool) {
    super(userId, "signal", "personal", config, pool)
    this._apiUrl = (config.signalCliUrl || process.env.SIGNAL_CLI_API_URL || "").replace(/\/$/, "")
    this._number = null
    this._pollTimer = null
    this._connecting = false
  }

  async start() {
    if (!this._apiUrl) {
      console.log("[Signal] No signal-cli API URL configured — connector disabled")
      this._permanentlyFailed = true
      await this.writeEvent("error", "Signal requires signal-cli-rest-api. Set SIGNAL_CLI_API_URL env var.").catch(() => {})
      await this.updateStatus("disconnected").catch(() => {})
      return
    }

    console.log(`[Signal] Starting Signal for user ${this.userId.slice(0, 8)}...`)
    console.log(`[Signal] API URL: ${this._apiUrl}`)

    // Check if signal-cli-rest-api is reachable
    try {
      const aboutRes = await fetch(`${this._apiUrl}/v1/about`, { signal: AbortSignal.timeout(5000) })
      if (!aboutRes.ok) throw new Error(`HTTP ${aboutRes.status}`)
      console.log("[Signal] signal-cli-rest-api is reachable")
    } catch (err) {
      console.error("[Signal] Cannot reach signal-cli-rest-api:", err.message)
      this._permanentlyFailed = true
      await this.writeEvent("error", `Cannot reach signal-cli API at ${this._apiUrl}`).catch(() => {})
      await this.updateStatus("disconnected").catch(() => {})
      return
    }

    // Check if already linked
    try {
      const accounts = await this._getAccounts()
      if (accounts.length > 0) {
        this._number = accounts[0]
        console.log(`[Signal] Already linked as ${this._number}`)
        this._running = true
        await this.writeEvent("connected", this._number)
        await this.updateStatus("connected")
        this._startMessagePolling()
        return
      }
    } catch (err) {
      console.log("[Signal] Could not check accounts:", err.message)
    }

    // Need to link — start QR process
    this._connecting = true
    await this._startLinking()
  }

  async stop() {
    this._running = false
    this._connecting = false
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  async send(recipient, text) {
    if (!this._number) throw new Error("Signal not linked")

    const chunks = []
    for (let i = 0; i < text.length; i += 2000) {
      chunks.push(text.slice(i, i + 2000))
    }

    for (const chunk of chunks) {
      const res = await fetch(`${this._apiUrl}/v2/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: chunk,
          number: this._number,
          recipients: [recipient],
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`Signal send failed: ${res.status} ${body}`)
      }
    }
  }

  get socket() {
    return this._running ? this : null
  }

  get isConnecting() {
    return this._connecting
  }

  get permanentlyFailed() {
    return this._permanentlyFailed === true
  }

  async _getAccounts() {
    const res = await fetch(`${this._apiUrl}/v1/accounts`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const data = await res.json()
    // Returns array of account numbers
    return Array.isArray(data) ? data.map(a => a.number || a) : []
  }

  async _startLinking() {
    try {
      console.log("[Signal] Starting device linking (QR generation)...")

      const res = await fetch(`${this._apiUrl}/v1/qrcodelink?device_name=DMMS+AI`, {
        signal: AbortSignal.timeout(60000),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`QR link failed: ${res.status} ${body}`)
      }

      // The response is a PNG image of the QR code
      const buffer = await res.arrayBuffer()
      const base64 = Buffer.from(buffer).toString("base64")
      const dataUrl = `data:image/png;base64,${base64}`

      console.log("[Signal] QR code generated — writing to channel_events")
      await this.writeEvent("qr", dataUrl)

      // Poll for account linking completion
      this._waitForLink()
    } catch (err) {
      console.error("[Signal] Linking error:", err.message)
      this._connecting = false
      await this.writeEvent("error", `Linking failed: ${err.message}`).catch(() => {})
    }
  }

  _waitForLink() {
    let attempts = 0
    const maxAttempts = 60 // Check for 2 minutes

    const checkInterval = setInterval(async () => {
      attempts++
      try {
        const accounts = await this._getAccounts()
        if (accounts.length > 0) {
          clearInterval(checkInterval)
          this._number = accounts[0]
          this._connecting = false
          this._running = true
          console.log(`[Signal] Linked successfully as ${this._number}`)
          await this.writeEvent("connected", this._number)
          await this.updateStatus("connected")
          this._startMessagePolling()
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval)
          this._connecting = false
          console.log("[Signal] Linking timed out")
          await this.writeEvent("error", "QR code expired. Try again.")
        }
      } catch {
        // Keep checking
      }
    }, 2000)
  }

  _startMessagePolling() {
    if (this._pollTimer) return
    console.log(`[Signal] Starting message polling for ${this._number}`)

    this._pollTimer = setInterval(async () => {
      if (!this._running || !this._number) return

      try {
        const res = await fetch(
          `${this._apiUrl}/v1/receive/${encodeURIComponent(this._number)}`,
          { signal: AbortSignal.timeout(10000) }
        )
        if (!res.ok) return

        const messages = await res.json()
        if (!Array.isArray(messages)) return

        for (const msg of messages) {
          // Only handle data messages (not receipts, typing, etc.)
          const envelope = msg.envelope || msg
          const dataMessage = envelope.dataMessage
          if (!dataMessage?.message) continue

          const text = dataMessage.message.trim()
          if (!text) continue

          const sender = envelope.source || envelope.sourceNumber
          if (!sender) continue

          // Skip our own messages
          if (sender === this._number) continue

          const senderName = envelope.sourceName || sender
          console.log(`[Signal:Receive] From ${senderName} (${sender}): "${text.slice(0, 60)}"`)

          try {
            const reply = await this.handleMessage(sender, text, {
              channelName: "Signal",
              onTyping: () => {},
            })

            await this.send(sender, reply)

            const preview = (s) => (s || "").slice(0, 50).replace(/\n/g, " ")
            console.log(`[Signal] ${senderName}: "${preview(text)}" → "${preview(reply)}"`)
          } catch (err) {
            console.error("[Signal] Pipeline error:", err.message)
            await this.send(sender, "Sorry, something went wrong. Please try again.").catch(() => {})
          }
        }
      } catch {
        // Silently continue polling
      }
    }, 3000)
  }
}
