/**
 * Baileys PostgreSQL Auth State Adapter
 *
 * Persists Baileys (WhatsApp Web) authentication credentials in PostgreSQL
 * instead of the filesystem. Required for Railway/Heroku where the filesystem
 * is ephemeral.
 *
 * Implements the interface Baileys expects:
 *   - state.creds  — Signal protocol identity
 *   - state.keys.get(type, ids) — Read pre-keys, sender-keys, sessions, etc.
 *   - state.keys.set(data) — Write key batches
 *   - saveCreds() — Persist creds after each update
 *
 * Uses the existing pg Pool connection.
 */

import pg from "pg"
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys"

const { Pool } = pg

/**
 * @param {string} connectionString - DATABASE_URL
 * @param {string} userId - The DMMS AI user ID who owns this WhatsApp session
 * @returns {{ state: import("@whiskeysockets/baileys").AuthenticationState, saveCreds: () => Promise<void> }}
 */
export async function usePgAuthState(connectionString, userId) {
  const pool = new Pool({ connectionString, max: 3 })

  // ── Helpers ──────────────────────────────────────────────────────────

  async function readData(id) {
    const res = await pool.query(
      "SELECT data FROM baileys_auth WHERE user_id = $1 AND id = $2",
      [userId, id]
    )
    if (res.rows.length === 0) return null
    return JSON.parse(JSON.stringify(res.rows[0].data), BufferJSON.reviver)
  }

  async function writeData(id, value) {
    const data = JSON.parse(JSON.stringify(value, BufferJSON.replacer))
    await pool.query(
      `INSERT INTO baileys_auth (id, user_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (user_id, id)
       DO UPDATE SET data = $3, updated_at = NOW()`,
      [id, userId, JSON.stringify(data)]
    )
  }

  async function removeData(id) {
    await pool.query(
      "DELETE FROM baileys_auth WHERE user_id = $1 AND id = $2",
      [userId, id]
    )
  }

  // ── Load or create creds ─────────────────────────────────────────────

  const existingCreds = await readData("creds")
  const creds = existingCreds || initAuthCreds()

  // ── Build auth state ─────────────────────────────────────────────────

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const result = {}
        for (const id of ids) {
          const key = `${type}-${id}`
          const value = await readData(key)
          if (value) {
            // Baileys expects pre-key and session objects to be protobuf-decoded
            if (type === "app-state-sync-key") {
              result[id] = proto.Message.AppStateSyncKeyData.fromObject(value)
            } else {
              result[id] = value
            }
          }
        }
        return result
      },
      set: async (data) => {
        // data is { type: { id: value | null } }
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries)) {
            const key = `${type}-${id}`
            if (value) {
              await writeData(key, value)
            } else {
              await removeData(key)
            }
          }
        }
      },
    },
  }

  // ── saveCreds — called by Baileys on every credential update ─────────

  async function saveCreds() {
    await writeData("creds", state.creds)
  }

  return { state, saveCreds, pool }
}

/**
 * Clear all Baileys auth data for a user (used on disconnect/logout)
 */
export async function clearPgAuthState(connectionString, userId) {
  const pool = new Pool({ connectionString, max: 2 })
  try {
    await pool.query("DELETE FROM baileys_auth WHERE user_id = $1", [userId])
  } finally {
    await pool.end()
  }
}
