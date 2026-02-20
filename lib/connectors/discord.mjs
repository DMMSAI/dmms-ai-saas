/**
 * DMMS AI — Discord Connector
 * discord.js client with message intents.
 */

import { Client, GatewayIntentBits } from "discord.js"
import { BaseConnector } from "./base.mjs"

export class DiscordConnector extends BaseConnector {
  constructor(userId, config, pool) {
    super(userId, "discord", "business", config, pool)
    this._token = config.botToken
    this._client = null
  }

  async start() {
    if (!this._token) {
      console.log("[DC] No Discord bot token — skipping")
      return
    }

    console.log("[DC] Starting Discord bot...")

    this._client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    })

    this._client.on("ready", async () => {
      console.log(`[DC] Connected as ${this._client.user.tag}`)
      await this.writeEvent("connected", this._client.user.tag).catch(() => {})
      await this.updateStatus("connected")
      this._running = true
    })

    this._client.on("messageCreate", async (message) => {
      if (message.author.bot) return

      const text = message.content?.trim()
      if (!text) return

      const peer = `${message.channel.id}:${message.author.id}`

      console.log(`[DC:Receive] From ${message.author.username} in #${message.channel.name || "DM"}: "${text.slice(0, 60)}"`)

      try {
        message.channel.sendTyping().catch(() => {})

        const reply = await this.handleMessage(peer, text, {
          channelName: "Discord",
          onTyping: () => {
            message.channel.sendTyping().catch(() => {})
          },
        })

        await this.send(message.channel.id, reply, message)

        const preview = (s) => (s || "").slice(0, 50).replace(/\n/g, " ")
        console.log(`[DC] ${message.author.username}: "${preview(text)}" → "${preview(reply)}"`)
      } catch (err) {
        console.error("[DC] Pipeline error:", err.message)
        await message.reply("Sorry, something went wrong. Please try again.").catch(() => {})
      }
    })

    this._client.on("error", (err) => {
      console.error("[DC] Client error:", err.message)
    })

    try {
      await this._client.login(this._token)
    } catch (err) {
      console.error("[DC] Login failed:", err.message)
      await this.writeEvent("error", err.message).catch(() => {})
    }
  }

  async stop() {
    this._running = false
    if (this._client) {
      this._client.destroy()
      this._client = null
    }
  }

  async send(channelId, text, originalMessage) {
    if (!this._client) throw new Error("Discord not connected")

    // Split long messages (Discord limit: 2000 chars)
    const chunks = []
    for (let i = 0; i < text.length; i += 1900) {
      chunks.push(text.slice(i, i + 1900))
    }

    const channel = originalMessage?.channel || await this._client.channels.fetch(channelId)

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0 && originalMessage) {
        await originalMessage.reply(chunks[i])
      } else {
        await channel.send(chunks[i])
      }
    }
  }
}
