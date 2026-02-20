/**
 * DMMS AI — Connector Registry
 * Manages all active connectors, syncs with DB, handles start/stop lifecycle.
 */

import { TelegramConnector } from "./telegram.mjs"
import { WhatsAppConnector } from "./whatsapp.mjs"
import { DiscordConnector } from "./discord.mjs"
import { SlackConnector } from "./slack.mjs"
import { WeChatConnector } from "./wechat.mjs"

/** Map of channelType → Connector class */
const CONNECTOR_CLASSES = {
  telegram: TelegramConnector,
  whatsapp: WhatsAppConnector,
  discord: DiscordConnector,
  slack: SlackConnector,
  wechat: WeChatConnector,
}

export class ConnectorRegistry {
  constructor(pool, pipeline) {
    this.pool = pool
    this.pipeline = pipeline
    /** @type {Map<string, import("./base.mjs").BaseConnector>} */
    this.connectors = new Map()
    /** @type {Set<string>} Keys of connectors that permanently failed (e.g. missing module) */
    this._failedKeys = new Set()
    this._pollTimer = null
  }

  /** Generate a unique key for a connector */
  _key(userId, channelType, connectionMode) {
    return `${userId}:${channelType}:${connectionMode}`
  }

  /** Start a connector and register it */
  async startConnector(userId, channelType, connectionMode, config) {
    const key = this._key(userId, channelType, connectionMode)

    // Skip if already running or permanently failed
    if (this.connectors.has(key)) return
    if (this._failedKeys.has(key)) return

    const ConnectorClass = CONNECTOR_CLASSES[channelType]
    if (!ConnectorClass) {
      // Generic/unsupported channel — just log config status
      const hasConfig = Object.values(config || {}).some(v => v && String(v).trim())
      if (hasConfig) {
        console.log(`[${channelType.toUpperCase()}] Channel enabled — config saved, gateway ready`)
      }
      return
    }

    const connector = new ConnectorClass(userId, config, this.pool)
    connector.setPipeline(this.pipeline)
    this.connectors.set(key, connector)

    try {
      await connector.start()
      // Check if connector permanently failed during start (e.g. missing module)
      if (connector.permanentlyFailed) {
        this.connectors.delete(key)
        this._failedKeys.add(key)
      }
    } catch (err) {
      console.error(`[${channelType.toUpperCase()}] Start failed:`, err.message)
      this.connectors.delete(key)
    }
  }

  /** Stop a specific connector */
  async stopConnector(userId, channelType, connectionMode) {
    const key = this._key(userId, channelType, connectionMode)
    const connector = this.connectors.get(key)
    if (!connector) return

    try {
      await connector.stop()
    } catch (err) {
      console.error(`[${channelType}] Stop error:`, err.message)
    }
    this.connectors.delete(key)
  }

  /** Get a specific connector instance */
  getConnector(userId, channelType, connectionMode) {
    return this.connectors.get(this._key(userId, channelType, connectionMode))
  }

  /**
   * Sync connectors with DB — start new ones, keep existing.
   */
  async syncFromDB() {
    const res = await this.pool.query(
      'SELECT "userId", "channelType", "connectionMode", config, enabled FROM "UserChannel" WHERE enabled = true'
    )

    const activeKeys = new Set()

    for (const row of res.rows) {
      const raw = row.config
      const config = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {})
      const connectionMode = row.connectionMode || "business"
      const key = this._key(row.userId, row.channelType, connectionMode)
      activeKeys.add(key)

      // Start if not already running
      if (!this.connectors.has(key)) {
        await this.startConnector(row.userId, row.channelType, connectionMode, config)
      }
    }

    // Check for QR-based connectors (WhatsApp, WeChat) that need restart
    // If enabled but no active socket and not connecting, restart them
    const QR_CHANNEL_TYPES = ["whatsapp", "wechat"]
    for (const [key, connector] of this.connectors) {
      // Skip permanently failed connectors
      if (connector.permanentlyFailed) {
        this.connectors.delete(key)
        this._failedKeys.add(key)
        continue
      }
      if (QR_CHANNEL_TYPES.includes(connector.channelType) && !connector.socket && !connector.isConnecting) {
        if (activeKeys.has(key)) {
          console.log(`[${connector.channelType.toUpperCase()}] Detected stale connector — restarting...`)
          this.connectors.delete(key)
          const parts = key.split(":")
          const row = res.rows.find(r => r.userId === parts[0] && r.channelType === connector.channelType)
          if (row) {
            const config = typeof row.config === "string" ? JSON.parse(row.config || "{}") : (row.config || {})
            // Skip if business API mode (has accessToken or appId)
            if (!config.accessToken && !config.appId) {
              await this.startConnector(row.userId, connector.channelType, parts[2] || "personal", config)
            }
          }
        }
      }
    }
  }

  /**
   * Start periodic polling for DB changes.
   */
  pollForChanges(intervalMs = 5000) {
    this._pollTimer = setInterval(async () => {
      try {
        await this.syncFromDB()
      } catch (err) {
        // Silently continue polling
      }
    }, intervalMs)
  }

  /** Stop all connectors and polling */
  async stopAll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }

    const stopPromises = []
    for (const [key, connector] of this.connectors) {
      stopPromises.push(
        connector.stop().catch((err) => {
          console.error(`[${key}] Stop error:`, err.message)
        })
      )
    }
    await Promise.allSettled(stopPromises)
    this.connectors.clear()
  }
}
