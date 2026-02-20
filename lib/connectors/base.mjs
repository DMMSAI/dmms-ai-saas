/**
 * DMMS AI — Base Connector
 * Abstract base class for all messaging platform connectors.
 */

import { randomBytes } from "crypto"

const cuid = () => "c" + randomBytes(12).toString("hex")

export class BaseConnector {
  /**
   * @param {string} userId - DMMS AI user ID who owns this connector
   * @param {string} channelType - e.g. "telegram", "whatsapp", "discord", "slack"
   * @param {string} connectionMode - "business" or "personal"
   * @param {object} config - Channel-specific configuration (tokens, etc.)
   * @param {import("pg").Pool} pool - PostgreSQL connection pool
   */
  constructor(userId, channelType, connectionMode, config, pool) {
    this.userId = userId
    this.channelType = channelType
    this.connectionMode = connectionMode
    this.config = config
    this.pool = pool
    this._pipeline = null
    this._running = false
  }

  /** Register the middleware pipeline to process incoming messages */
  setPipeline(pipeline) {
    this._pipeline = pipeline
  }

  /** Start the connector (abstract — must override) */
  async start() {
    throw new Error("start() not implemented")
  }

  /** Stop the connector (abstract — must override) */
  async stop() {
    this._running = false
  }

  /** Send a message to a peer (abstract — must override) */
  async send(peerId, text) {
    throw new Error("send() not implemented")
  }

  /**
   * Handle an incoming message by running it through the pipeline.
   * @param {string} peerId - Platform-specific peer identifier
   * @param {string} text - Message text
   * @param {object} extra - { channelName, onTyping, ... }
   */
  async handleMessage(peerId, text, extra = {}) {
    if (!this._pipeline) {
      console.error(`[${this.channelType}] No pipeline configured`)
      return
    }

    const ctx = {
      channelType: this.channelType,
      channelName: extra.channelName || this.channelType,
      channelPeer: peerId,
      connectionMode: this.connectionMode,
      text,
      startTime: Date.now(),
      userId: this.userId,
      toolsUsed: [],
      onTyping: extra.onTyping || (() => {}),
    }

    try {
      await this._pipeline(ctx)
      return ctx.reply
    } catch (err) {
      console.error(`[${this.channelType}] Pipeline error:`, err.message)
      throw err
    }
  }

  /** Write a channel event to the DB */
  async writeEvent(eventType, payload) {
    await this.pool.query(
      "INSERT INTO channel_events (id, user_id, channel_type, event_type, payload, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
      [cuid(), this.userId, this.channelType, eventType, payload || null]
    )
  }

  /** Update channel status in the UserChannel table */
  async updateStatus(status) {
    await this.pool.query(
      'UPDATE "UserChannel" SET status = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "channelType" = $3 AND "connectionMode" = $4',
      [status, this.userId, this.channelType, this.connectionMode]
    ).catch(() => {
      // Fallback: try without connectionMode for backward compatibility
      this.pool.query(
        'UPDATE "UserChannel" SET status = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "channelType" = $3',
        [status, this.userId, this.channelType]
      ).catch(() => {})
    })
  }
}
