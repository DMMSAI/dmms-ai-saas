"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface ChannelInfo {
  type: string
  name: string
  description: string
  configFields: { key: string; label: string; placeholder: string; type?: string }[]
  connectionMethod: string
  /** Whether this channel supports personal (QR) mode */
  hasPersonalMode?: boolean
  personalDescription?: string
}

const CHANNELS: ChannelInfo[] = [
  {
    type: "web",
    name: "Web Chat",
    description: "Built-in browser chat — always available",
    configFields: [],
    connectionMethod: "built-in",
  },
  {
    type: "whatsapp",
    name: "WhatsApp",
    description: "Connect via WhatsApp Business API or scan QR to link",
    configFields: [
      { key: "accessToken", label: "Access Token", placeholder: "WhatsApp Business API token" },
      { key: "phoneNumberId", label: "Phone Number ID", placeholder: "e.g. 123456789012345" },
      { key: "webhookVerifyToken", label: "Webhook Verify Token", placeholder: "Your verify token" },
    ],
    connectionMethod: "token",
    hasPersonalMode: true,
    personalDescription: "Scan QR code to link as WhatsApp Web device (Baileys)",
  },
  {
    type: "telegram",
    name: "Telegram",
    description: "Connect via Telegram Bot API",
    configFields: [{ key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" }],
    connectionMethod: "token",
  },
  {
    type: "discord",
    name: "Discord",
    description: "Connect a Discord bot to your server",
    configFields: [
      { key: "botToken", label: "Bot Token", placeholder: "Discord bot token" },
      { key: "applicationId", label: "Application ID", placeholder: "e.g. 123456789012345678" },
    ],
    connectionMethod: "token",
  },
  {
    type: "slack",
    name: "Slack",
    description: "Connect via Slack Bolt SDK",
    configFields: [
      { key: "botToken", label: "Bot Token (xoxb-)", placeholder: "xoxb-..." },
      { key: "appToken", label: "App Token (xapp-)", placeholder: "xapp-..." },
      { key: "signingSecret", label: "Signing Secret", placeholder: "Slack signing secret" },
    ],
    connectionMethod: "token",
  },
  {
    type: "signal",
    name: "Signal",
    description: "Connect via signal-cli bridge",
    configFields: [
      { key: "signalNumber", label: "Phone Number", placeholder: "+1234567890" },
      { key: "signalCliPath", label: "signal-cli API URL", placeholder: "http://localhost:8080" },
    ],
    connectionMethod: "bridge",
  },
  {
    type: "imessage",
    name: "iMessage",
    description: "Connect via BlueBubbles REST API",
    configFields: [
      { key: "serverUrl", label: "BlueBubbles Server URL", placeholder: "http://localhost:1234" },
      { key: "password", label: "Server Password", placeholder: "BlueBubbles password", type: "password" },
    ],
    connectionMethod: "api",
  },
  {
    type: "googlechat",
    name: "Google Chat",
    description: "Connect via Google Chat API webhook",
    configFields: [
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://chat.googleapis.com/v1/spaces/..." },
      { key: "serviceAccountKey", label: "Service Account Key (JSON)", placeholder: "Paste service account JSON" },
    ],
    connectionMethod: "webhook",
  },
  {
    type: "msteams",
    name: "Microsoft Teams",
    description: "Connect via Bot Framework",
    configFields: [
      { key: "appId", label: "App ID", placeholder: "Microsoft App ID" },
      { key: "appPassword", label: "App Password", placeholder: "Microsoft App Password", type: "password" },
    ],
    connectionMethod: "oauth",
  },
  {
    type: "irc",
    name: "IRC",
    description: "Connect to any IRC server",
    configFields: [
      { key: "server", label: "Server", placeholder: "irc.libera.chat" },
      { key: "port", label: "Port", placeholder: "6697" },
      { key: "channel", label: "Channel", placeholder: "#my-channel" },
      { key: "nickname", label: "Nickname", placeholder: "dmms-ai" },
    ],
    connectionMethod: "config",
  },
  {
    type: "line",
    name: "LINE",
    description: "Connect via LINE Messaging API",
    configFields: [
      { key: "channelAccessToken", label: "Channel Access Token", placeholder: "LINE channel access token" },
      { key: "channelSecret", label: "Channel Secret", placeholder: "LINE channel secret" },
    ],
    connectionMethod: "token",
  },
  {
    type: "matrix",
    name: "Matrix",
    description: "Connect via Matrix protocol (Element, etc.)",
    configFields: [
      { key: "homeserver", label: "Homeserver URL", placeholder: "https://matrix.org" },
      { key: "accessToken", label: "Access Token", placeholder: "Matrix access token" },
      { key: "userId", label: "Bot User ID", placeholder: "@dmms-ai:matrix.org" },
    ],
    connectionMethod: "token",
  },
  {
    type: "twitch",
    name: "Twitch",
    description: "Connect to Twitch chat via IRC",
    configFields: [
      { key: "oauthToken", label: "OAuth Token", placeholder: "oauth:abc123..." },
      { key: "channel", label: "Channel Name", placeholder: "your_channel" },
      { key: "botUsername", label: "Bot Username", placeholder: "dmms_ai_bot" },
    ],
    connectionMethod: "token",
  },
  {
    type: "nostr",
    name: "Nostr",
    description: "Decentralized DMs via NIP-04",
    configFields: [
      { key: "privateKey", label: "Private Key (nsec)", placeholder: "nsec1...", type: "password" },
      { key: "relays", label: "Relay URLs (comma-separated)", placeholder: "wss://relay.damus.io,wss://nos.lol" },
    ],
    connectionMethod: "key",
  },
  {
    type: "zalo",
    name: "Zalo",
    description: "Connect via Zalo Bot API or scan QR",
    configFields: [
      { key: "oaAccessToken", label: "OA Access Token", placeholder: "Zalo OA access token" },
      { key: "oaSecretKey", label: "OA Secret Key", placeholder: "Zalo OA secret key", type: "password" },
    ],
    connectionMethod: "token",
    hasPersonalMode: true,
    personalDescription: "Connect personal Zalo via QR login (zca-cli)",
  },
  {
    type: "mattermost",
    name: "Mattermost",
    description: "Connect via Mattermost Bot API",
    configFields: [
      { key: "serverUrl", label: "Server URL", placeholder: "https://mattermost.example.com" },
      { key: "botToken", label: "Bot Token", placeholder: "Mattermost bot token" },
    ],
    connectionMethod: "token",
  },
  {
    type: "nextcloud",
    name: "Nextcloud Talk",
    description: "Connect to self-hosted Nextcloud Talk",
    configFields: [
      { key: "serverUrl", label: "Nextcloud URL", placeholder: "https://cloud.example.com" },
      { key: "username", label: "Username", placeholder: "bot-user" },
      { key: "password", label: "App Password", placeholder: "Nextcloud app password", type: "password" },
    ],
    connectionMethod: "api",
  },
  {
    type: "feishu",
    name: "Feishu / Lark",
    description: "Connect via Feishu WebSocket bot",
    configFields: [
      { key: "appId", label: "App ID", placeholder: "Feishu App ID" },
      { key: "appSecret", label: "App Secret", placeholder: "Feishu App Secret", type: "password" },
    ],
    connectionMethod: "websocket",
  },
  {
    type: "tlon",
    name: "Tlon (Urbit)",
    description: "Connect via Urbit messenger",
    configFields: [
      { key: "shipUrl", label: "Ship URL", placeholder: "http://localhost:8080" },
      { key: "shipCode", label: "Access Code", placeholder: "+code from your ship", type: "password" },
    ],
    connectionMethod: "api",
  },
  {
    type: "viber",
    name: "Viber",
    description: "Connect via Viber Bot API",
    configFields: [
      { key: "botToken", label: "Auth Token", placeholder: "Viber bot auth token" },
      { key: "botName", label: "Bot Name", placeholder: "DMMS AI" },
    ],
    connectionMethod: "token",
  },
  {
    type: "wechat",
    name: "WeChat",
    description: "Connect via WeChat Official Account",
    configFields: [
      { key: "appId", label: "App ID", placeholder: "WeChat App ID" },
      { key: "appSecret", label: "App Secret", placeholder: "WeChat App Secret", type: "password" },
      { key: "token", label: "Token", placeholder: "Verification token" },
    ],
    connectionMethod: "oauth",
  },
  {
    type: "rocketchat",
    name: "Rocket.Chat",
    description: "Connect via Rocket.Chat webhook",
    configFields: [
      { key: "serverUrl", label: "Server URL", placeholder: "https://rocketchat.example.com" },
      { key: "webhookToken", label: "Webhook Token", placeholder: "Rocket.Chat webhook token" },
    ],
    connectionMethod: "webhook",
  },
  {
    type: "threema",
    name: "Threema",
    description: "Connect via Threema Gateway",
    configFields: [
      { key: "gatewayId", label: "Gateway ID", placeholder: "*MYID" },
      { key: "apiSecret", label: "API Secret", placeholder: "Threema API secret", type: "password" },
    ],
    connectionMethod: "gateway",
  },
]

interface SavedChannel {
  id: string
  channelType: string
  connectionMode?: string
  config: Record<string, string>
  enabled: boolean
  status: string
}

// ── WhatsApp QR Component ────────────────────────────────────────────

function QrScanCard({
  channelType,
  channelName,
  description,
  saved,
  onDisconnect,
}: {
  channelType: string
  channelName: string
  description: string
  saved?: SavedChannel
  onDisconnect: () => void
}) {
  const [status, setStatus] = useState<string>(saved?.status || "disconnected")
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastQr = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/channels/${channelType}/qr`)
        const data = await res.json()

        if (data.status === "connected") {
          setStatus("connected")
          setQrDataUrl(null)
          setConnecting(false)
          stopPolling()
        } else if (data.status === "qr" && data.qr) {
          setStatus("qr")
          if (data.qr !== lastQr.current) {
            lastQr.current = data.qr
            try {
              const QRCode = (await import("qrcode")).default
              const url = await QRCode.toDataURL(data.qr, { width: 256, margin: 2 })
              setQrDataUrl(url)
            } catch {
              setQrDataUrl(null)
            }
          }
        } else if (data.status === "logged_out") {
          setStatus("logged_out")
          setConnecting(false)
          stopPolling()
        } else if (data.status === "error") {
          setStatus("error")
          setConnecting(false)
          stopPolling()
        }
      } catch {
        // keep polling
      }
    }, 2000)
  }, [stopPolling, channelType])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  useEffect(() => {
    if (saved?.enabled && saved?.status === "connected") setStatus("connected")
  }, [saved])

  const handleConnect = async () => {
    setConnecting(true)
    setStatus("connecting")
    setQrDataUrl(null)
    try {
      const res = await fetch(`/api/channels/${channelType}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionMode: "personal" }),
      })
      const data = await res.json()
      if (data.ok) startPolling()
      else { setStatus("error"); setConnecting(false) }
    } catch {
      setStatus("error"); setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    stopPolling()
    setConnecting(false)
    setQrDataUrl(null)
    try {
      await fetch(`/api/channels/${channelType}/connect`, { method: "DELETE" })
      setStatus("disconnected")
      onDisconnect()
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">{description}</p>

      {status === "qr" && qrDataUrl && (
        <div className="flex flex-col items-center">
          <div className="rounded-lg border border-zinc-700 bg-white p-2">
            <img src={qrDataUrl} alt={`${channelName} QR Code`} width={256} height={256} />
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Scan this QR code with your {channelName} app to link
          </p>
        </div>
      )}

      {status === "connecting" && !qrDataUrl && (
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
          <p className="text-sm text-zinc-400">Waiting for QR code...</p>
        </div>
      )}

      {status === "connected" && (
        <p className="text-sm text-teal-400">
          {channelName} is linked and receiving messages. AI responds automatically.
        </p>
      )}

      {status === "logged_out" && (
        <p className="text-sm text-yellow-400">
          Session logged out. Click Connect to re-link.
        </p>
      )}

      {status === "error" && (
        <p className="text-sm text-red-400">Connection error. Try again.</p>
      )}

      <div className="flex gap-2">
        {status !== "connected" && status !== "qr" && status !== "connecting" && (
          <Button size="sm" onClick={handleConnect} disabled={connecting}>
            {connecting ? "Connecting..." : `Connect ${channelName}`}
          </Button>
        )}
        {(status === "connected" || status === "qr" || status === "connecting") && (
          <Button size="sm" variant="ghost" onClick={handleDisconnect}>Disconnect</Button>
        )}
      </div>
    </div>
  )
}

// ── Mode Tab Component ───────────────────────────────────────────────

function ModeTab({
  activeMode,
  onModeChange,
  hasPersonalMode,
}: {
  activeMode: "business" | "personal"
  onModeChange: (mode: "business" | "personal") => void
  hasPersonalMode: boolean
}) {
  return (
    <div className="mb-3 flex gap-1 rounded-lg bg-zinc-800/50 p-1">
      <button
        onClick={() => onModeChange("business")}
        className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          activeMode === "business"
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-400 hover:text-zinc-300"
        }`}
      >
        Business
      </button>
      <button
        onClick={() => onModeChange("personal")}
        disabled={!hasPersonalMode}
        className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          activeMode === "personal"
            ? "bg-zinc-700 text-zinc-100"
            : hasPersonalMode
              ? "text-zinc-400 hover:text-zinc-300"
              : "cursor-not-allowed text-zinc-600"
        }`}
      >
        Personal
      </button>
    </div>
  )
}

// ── Main Channels Page ───────────────────────────────────────────────

export default function ChannelsPage() {
  const [savedChannels, setSavedChannels] = useState<SavedChannel[]>([])
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [channelModes, setChannelModes] = useState<Record<string, "business" | "personal">>({})

  useEffect(() => {
    fetch("/api/channels")
      .then((r) => r.json())
      .then((channels) => {
        if (!Array.isArray(channels)) return
        const parsed = channels.map((ch: SavedChannel & { config: string | Record<string, string> }) => ({
          ...ch,
          config: typeof ch.config === "string" ? JSON.parse(ch.config || "{}") : ch.config,
        }))
        setSavedChannels(parsed)
      })
      .catch(() => {})
  }, [])

  const getMode = (type: string) => channelModes[type] || "business"

  const save = async (channelType: string, enabled: boolean) => {
    setSaving(true)
    setStatusMessage(null)
    const mode = getMode(channelType)
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelType, config: formData, enabled, connectionMode: mode }),
      })
      const updated = await res.json()

      if (typeof updated.config === "string") {
        try { updated.config = JSON.parse(updated.config) } catch { updated.config = {} }
      }

      setSavedChannels((prev) => {
        const idx = prev.findIndex((c) => c.channelType === channelType && (c.connectionMode || "business") === mode)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = updated
          return next
        }
        return [...prev, updated]
      })

      // Channel-specific post-save actions
      if (channelType === "telegram" && enabled && formData.botToken) {
        setStatusMessage({ type: "success", text: "Saved! Registering Telegram webhook..." })
        const whRes = await fetch("/api/channels/telegram/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "register" }),
        })
        const whData = await whRes.json()
        setStatusMessage(whData.ok
          ? { type: "success", text: `Telegram connected! Bot: @${whData.botUsername || "your-bot"}` }
          : { type: "error", text: `Webhook failed: ${whData.description || whData.error || "Unknown"}` }
        )
      } else if (channelType === "telegram" && !enabled) {
        await fetch("/api/channels/telegram/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unregister" }),
        }).catch(() => {})
        setStatusMessage({ type: "success", text: "Telegram disconnected." })
      } else if (enabled) {
        const ch = CHANNELS.find((c) => c.type === channelType)
        setStatusMessage({ type: "success", text: `${ch?.name || channelType} saved & enabled! Gateway will connect on next restart.` })
      } else {
        setStatusMessage({ type: "success", text: "Channel disconnected." })
      }

      setConfiguring(null)
      setFormData({})
    } catch {
      setStatusMessage({ type: "error", text: "Failed to save channel." })
    } finally {
      setSaving(false)
    }
  }

  const getSavedChannel = (type: string, mode?: string) =>
    savedChannels.find((c) => c.channelType === type && (c.connectionMode || "business") === (mode || "business"))

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Channels</h1>
        <p className="text-sm text-zinc-400">
          Connect 24 messaging platforms to your AI assistant — Business or Personal mode
        </p>
      </div>

      {statusMessage && (
        <div
          className={`rounded-lg p-3 text-sm ${
            statusMessage.type === "success"
              ? "bg-teal-500/10 text-teal-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {CHANNELS.map((ch) => {
          const mode = getMode(ch.type)
          const saved = getSavedChannel(ch.type, mode)
          const isConfiguring = configuring === ch.type

          // Web Chat — always active
          if (ch.type === "web") {
            return (
              <Card key={ch.type} className="relative">
                <CardTitle className="text-base">{ch.name}</CardTitle>
                <CardDescription className="mt-1">{ch.description}</CardDescription>
                <div className="mt-4">
                  <Badge variant="success">Always Active</Badge>
                </div>
              </Card>
            )
          }

          // Channels with dual mode support
          return (
            <Card key={ch.type} className="relative">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {ch.name}
                    {saved?.enabled && saved?.status === "connected" && (
                      <Badge variant="success">Connected</Badge>
                    )}
                    {saved?.enabled && saved?.status !== "connected" && (
                      <Badge variant="outline">Enabled</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">{ch.description}</CardDescription>
                </div>
              </div>

              {/* Mode Tabs — only show for channels with personal mode */}
              {ch.hasPersonalMode && (
                <div className="mt-3">
                  <ModeTab
                    activeMode={mode}
                    onModeChange={(m) => setChannelModes((prev) => ({ ...prev, [ch.type]: m }))}
                    hasPersonalMode={true}
                  />
                </div>
              )}

              {/* Personal Mode (QR Scan) */}
              {ch.hasPersonalMode && mode === "personal" ? (
                <QrScanCard
                  channelType={ch.type}
                  channelName={ch.name}
                  description={ch.personalDescription || "Connect via QR scan"}
                  saved={getSavedChannel(ch.type, "personal")}
                  onDisconnect={() => {
                    setSavedChannels((prev) =>
                      prev.map((c) =>
                        c.channelType === ch.type && c.connectionMode === "personal"
                          ? { ...c, enabled: false, status: "disconnected" }
                          : c
                      )
                    )
                  }}
                />
              ) : (
                <>
                  {/* Business Mode (Token/Config) */}
                  {isConfiguring && ch.configFields.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {ch.configFields.map((field) => (
                        <div key={field.key}>
                          <label className="mb-1 block text-xs font-medium text-zinc-400">
                            {field.label}
                          </label>
                          <Input
                            type={field.type || "text"}
                            placeholder={field.placeholder}
                            value={formData[field.key] || ""}
                            onChange={(e) =>
                              setFormData({ ...formData, [field.key]: e.target.value })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    {isConfiguring ? (
                      <>
                        <Button size="sm" onClick={() => save(ch.type, true)} disabled={saving}>
                          {saving ? "Connecting..." : "Save & Connect"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setConfiguring(null); setFormData({}); setStatusMessage(null) }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setConfiguring(ch.type); setFormData(saved?.config || {}); setStatusMessage(null) }}
                      >
                        {saved ? "Configure" : "Set Up"}
                      </Button>
                    )}
                    {saved?.enabled && !isConfiguring && (
                      <Button size="sm" variant="ghost" onClick={() => save(ch.type, false)}>
                        Disconnect
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
