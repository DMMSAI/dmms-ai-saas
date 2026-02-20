/**
 * DMMS AI — Slack Connector
 * Slack Bolt SDK with Socket Mode.
 */

import { BaseConnector } from "./base.mjs"

export class SlackConnector extends BaseConnector {
  constructor(userId, config, pool) {
    super(userId, "slack", "business", config, pool)
    this._botToken = config.botToken
    this._appToken = config.appToken
    this._app = null
  }

  async start() {
    if (!this._botToken || !this._appToken) {
      console.log("[SLACK] Missing bot/app token — skipping")
      return
    }

    console.log("[SLACK] Starting Slack bot...")

    try {
      const { default: bolt } = await import("@slack/bolt")
      this._app = new bolt.App({
        token: this._botToken,
        appToken: this._appToken,
        socketMode: true,
      })

      this._app.message(async ({ message, say }) => {
        if (message.subtype) return
        const text = message.text?.trim()
        if (!text) return

        const peer = `${message.channel}:${message.user}`
        console.log(`[SLACK:Receive] From ${message.user}: "${text.slice(0, 60)}"`)

        try {
          const reply = await this.handleMessage(peer, text, {
            channelName: "Slack",
          })
          await say(reply)
          console.log("[SLACK] Reply sent")
        } catch (err) {
          console.error("[SLACK] Pipeline error:", err.message)
          await say("Sorry, something went wrong.").catch(() => {})
        }
      })

      await this._app.start()
      this._running = true
      console.log("[SLACK] Connected!")
      await this.writeEvent("connected", null)
      await this.updateStatus("connected")
    } catch (err) {
      console.error("[SLACK] Failed:", err.message)
      await this.writeEvent("error", err.message).catch(() => {})
    }
  }

  async stop() {
    this._running = false
    if (this._app) {
      await this._app.stop().catch(() => {})
      this._app = null
    }
  }

  async send(channel, text) {
    if (!this._app) throw new Error("Slack not connected")
    await this._app.client.chat.postMessage({
      channel,
      text,
    })
  }
}
