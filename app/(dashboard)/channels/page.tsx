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
  available: boolean
}

const CHANNELS: ChannelInfo[] = [
  {
    type: "web",
    name: "Web Chat",
    description: "Built-in browser chat — always available",
    configFields: [],
    connectionMethod: "built-in",
    available: true,
  },
  {
    type: "whatsapp",
    name: "WhatsApp",
    description: "Scan QR code to link as WhatsApp Web device",
    configFields: [],
    connectionMethod: "qr",
    available: true,
  },
  {
    type: "telegram",
    name: "Telegram",
    description: "Connect a Telegram bot via Bot Token",
    configFields: [{ key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF..." }],
    connectionMethod: "token",
    available: true,
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
    available: true,
  },
  {
    type: "slack",
    name: "Slack",
    description: "Connect via Slack Bot + App Token",
    configFields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-..." },
      { key: "appToken", label: "App Token", placeholder: "xapp-..." },
    ],
    connectionMethod: "token",
    available: false,
  },
  {
    type: "signal",
    name: "Signal",
    description: "Signal via signal-cli bridge",
    configFields: [],
    connectionMethod: "cli",
    available: false,
  },
  {
    type: "line",
    name: "LINE",
    description: "LINE Messaging API",
    configFields: [{ key: "channelAccessToken", label: "Channel Access Token", placeholder: "LINE channel access token" }],
    connectionMethod: "token",
    available: false,
  },
  {
    type: "matrix",
    name: "Matrix",
    description: "Matrix (Element, etc.) via homeserver",
    configFields: [
      { key: "homeserver", label: "Homeserver URL", placeholder: "https://matrix.org" },
      { key: "accessToken", label: "Access Token", placeholder: "Matrix access token" },
    ],
    connectionMethod: "token",
    available: false,
  },
  {
    type: "msteams",
    name: "MS Teams",
    description: "Microsoft Teams via Bot Framework",
    configFields: [],
    connectionMethod: "oauth",
    available: false,
  },
  {
    type: "googlechat",
    name: "Google Chat",
    description: "Google Chat via Service Account",
    configFields: [],
    connectionMethod: "service-account",
    available: false,
  },
  {
    type: "mattermost",
    name: "Mattermost",
    description: "Mattermost via Webhook integration",
    configFields: [{ key: "webhookUrl", label: "Webhook URL", placeholder: "https://mattermost.example.com/hooks/..." }],
    connectionMethod: "webhook",
    available: false,
  },
  {
    type: "irc",
    name: "IRC",
    description: "IRC via irc-framework bridge",
    configFields: [
      { key: "server", label: "Server", placeholder: "irc.libera.chat" },
      { key: "channel", label: "Channel", placeholder: "#my-channel" },
    ],
    connectionMethod: "config",
    available: false,
  },
  {
    type: "twitch",
    name: "Twitch",
    description: "Twitch Chat via OAuth",
    configFields: [{ key: "oauthToken", label: "OAuth Token", placeholder: "oauth:..." }],
    connectionMethod: "token",
    available: false,
  },
  {
    type: "nostr",
    name: "Nostr",
    description: "Nostr decentralized messaging",
    configFields: [],
    connectionMethod: "key",
    available: false,
  },
  {
    type: "zalo",
    name: "Zalo",
    description: "Zalo Official Account API",
    configFields: [{ key: "oaAccessToken", label: "OA Access Token", placeholder: "Zalo OA access token" }],
    connectionMethod: "token",
    available: false,
  },
  {
    type: "imessage",
    name: "iMessage",
    description: "iMessage via BlueBubbles API",
    configFields: [],
    connectionMethod: "api",
    available: false,
  },
  {
    type: "viber",
    name: "Viber",
    description: "Viber Bot API",
    configFields: [{ key: "botToken", label: "Bot Token", placeholder: "Viber bot token" }],
    connectionMethod: "token",
    available: false,
  },
  {
    type: "wechat",
    name: "WeChat",
    description: "WeChat Official Account",
    configFields: [],
    connectionMethod: "oauth",
    available: false,
  },
  {
    type: "rocketchat",
    name: "Rocket.Chat",
    description: "Rocket.Chat via Webhook",
    configFields: [{ key: "webhookUrl", label: "Webhook URL", placeholder: "https://rocketchat.example.com/hooks/..." }],
    connectionMethod: "webhook",
    available: false,
  },
  {
    type: "threema",
    name: "Threema",
    description: "Threema Gateway",
    configFields: [{ key: "gatewayId", label: "Gateway ID", placeholder: "*MYGATEWAY" }],
    connectionMethod: "gateway",
    available: false,
  },
]

interface SavedChannel {
  id: string
  channelType: string
  config: Record<string, string>
  enabled: boolean
  status: string
}

// ── WhatsApp QR Component ────────────────────────────────────────────

function WhatsAppQrCard({ saved, onDisconnect }: { saved?: SavedChannel; onDisconnect: () => void }) {
  const [waStatus, setWaStatus] = useState<string>(saved?.status || "disconnected")
  const [qrData, setQrData] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

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
        const res = await fetch("/api/channels/whatsapp/qr")
        const data = await res.json()

        if (data.status === "connected") {
          setWaStatus("connected")
          setQrData(null)
          setQrDataUrl(null)
          setConnecting(false)
          stopPolling()
        } else if (data.status === "qr" && data.qr) {
          setWaStatus("qr")
          if (data.qr !== qrData) {
            setQrData(data.qr)
            // Generate QR code data URL using the qrcode library (loaded dynamically)
            try {
              const QRCode = (await import("qrcode")).default
              const url = await QRCode.toDataURL(data.qr, { width: 256, margin: 2 })
              setQrDataUrl(url)
            } catch {
              setQrDataUrl(null)
            }
          }
        } else if (data.status === "logged_out") {
          setWaStatus("logged_out")
          setConnecting(false)
          stopPolling()
        } else if (data.status === "error") {
          setWaStatus("error")
          setConnecting(false)
          stopPolling()
        }
      } catch {
        // Network error — keep polling
      }
    }, 2000)
  }, [stopPolling, qrData])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // If already connected, show connected state
  useEffect(() => {
    if (saved?.enabled && saved?.status === "connected") {
      setWaStatus("connected")
    }
  }, [saved])

  const handleConnect = async () => {
    setConnecting(true)
    setWaStatus("connecting")
    setQrData(null)
    setQrDataUrl(null)

    try {
      const res = await fetch("/api/channels/whatsapp/connect", { method: "POST" })
      const data = await res.json()

      if (data.ok) {
        startPolling()
      } else {
        setWaStatus("error")
        setConnecting(false)
      }
    } catch {
      setWaStatus("error")
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    stopPolling()
    setConnecting(false)
    setQrData(null)
    setQrDataUrl(null)

    try {
      await fetch("/api/channels/whatsapp/connect", { method: "DELETE" })
      setWaStatus("disconnected")
      onDisconnect()
    } catch {
      // ignore
    }
  }

  return (
    <Card className="relative">
      <div className="flex items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            WhatsApp
            {waStatus === "connected" && <Badge variant="success">Connected</Badge>}
            {(waStatus === "connecting" || waStatus === "qr") && (
              <Badge variant="outline" className="animate-pulse">Connecting...</Badge>
            )}
          </CardTitle>
          <CardDescription className="mt-1">
            Scan QR code to link as WhatsApp Web device
          </CardDescription>
        </div>
      </div>

      {/* QR Code Display */}
      {waStatus === "qr" && qrDataUrl && (
        <div className="mt-4 flex flex-col items-center">
          <div className="rounded-lg border border-zinc-700 bg-white p-2">
            <img src={qrDataUrl} alt="WhatsApp QR Code" width={256} height={256} />
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            QR code refreshes automatically every ~20 seconds
          </p>
        </div>
      )}

      {/* Connecting spinner */}
      {waStatus === "connecting" && !qrDataUrl && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
          <p className="text-sm text-zinc-400">Waiting for QR code...</p>
        </div>
      )}

      {/* Connected state */}
      {waStatus === "connected" && (
        <div className="mt-4">
          <p className="text-sm text-teal-400">
            WhatsApp is linked and receiving messages. AI will respond automatically.
          </p>
        </div>
      )}

      {/* Logged out / error */}
      {waStatus === "logged_out" && (
        <div className="mt-4">
          <p className="text-sm text-yellow-400">
            Session was logged out from the phone. Click Connect to re-link.
          </p>
        </div>
      )}

      {waStatus === "error" && (
        <div className="mt-4">
          <p className="text-sm text-red-400">
            Connection error. Try connecting again.
          </p>
        </div>
      )}

      {/* Buttons */}
      <div className="mt-4 flex gap-2">
        {waStatus !== "connected" && waStatus !== "qr" && waStatus !== "connecting" && (
          <Button size="sm" onClick={handleConnect} disabled={connecting}>
            {connecting ? "Connecting..." : "Connect WhatsApp"}
          </Button>
        )}
        {(waStatus === "connected" || waStatus === "qr" || waStatus === "connecting") && (
          <Button size="sm" variant="ghost" onClick={handleDisconnect}>
            Disconnect
          </Button>
        )}
      </div>
    </Card>
  )
}

// ── Main Channels Page ───────────────────────────────────────────────

export default function ChannelsPage() {
  const [savedChannels, setSavedChannels] = useState<SavedChannel[]>([])
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    fetch("/api/channels")
      .then((r) => r.json())
      .then((channels) => {
        const parsed = channels.map((ch: SavedChannel & { config: string | Record<string, string> }) => ({
          ...ch,
          config: typeof ch.config === "string" ? JSON.parse(ch.config || "{}") : ch.config,
        }))
        setSavedChannels(parsed)
      })
      .catch(() => {})
  }, [])

  const save = async (channelType: string, enabled: boolean) => {
    setSaving(true)
    setStatusMessage(null)
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelType, config: formData, enabled }),
      })
      const updated = await res.json()

      if (typeof updated.config === "string") {
        try { updated.config = JSON.parse(updated.config) } catch { updated.config = {} }
      }

      setSavedChannels((prev) => {
        const idx = prev.findIndex((c) => c.channelType === channelType)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = updated
          return next
        }
        return [...prev, updated]
      })

      // Auto-register webhook for Telegram
      if (channelType === "telegram" && enabled && formData.botToken) {
        setStatusMessage({ type: "success", text: "Config saved. Registering Telegram webhook..." })
        const whRes = await fetch("/api/channels/telegram/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "register" }),
        })
        const whData = await whRes.json()
        if (whData.ok) {
          setStatusMessage({
            type: "success",
            text: `Telegram connected! Bot: @${whData.botUsername || "your-bot"}. Send it a message to test.`,
          })
        } else {
          setStatusMessage({
            type: "error",
            text: `Webhook registration failed: ${whData.description || whData.error || "Unknown error"}`,
          })
        }
      } else if (channelType === "telegram" && !enabled) {
        await fetch("/api/channels/telegram/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unregister" }),
        })
        setStatusMessage({ type: "success", text: "Telegram disconnected." })
      } else if (channelType === "discord" && enabled) {
        setStatusMessage({
          type: "success",
          text: "Discord config saved! The bot will connect automatically on next gateway restart.",
        })
      } else {
        setStatusMessage({ type: "success", text: "Channel saved!" })
      }

      setConfiguring(null)
      setFormData({})
    } catch {
      setStatusMessage({ type: "error", text: "Failed to save channel." })
    } finally {
      setSaving(false)
    }
  }

  const getSavedChannel = (type: string) =>
    savedChannels.find((c) => c.channelType === type)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Channels</h1>
        <p className="text-sm text-zinc-400">
          Connect messaging platforms to your AI assistant — 20+ platforms supported
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
          const saved = getSavedChannel(ch.type)
          const isConfiguring = configuring === ch.type

          // WhatsApp gets a special QR card
          if (ch.type === "whatsapp") {
            return (
              <WhatsAppQrCard
                key={ch.type}
                saved={saved}
                onDisconnect={() => {
                  setSavedChannels((prev) =>
                    prev.map((c) =>
                      c.channelType === "whatsapp" ? { ...c, enabled: false, status: "disconnected" } : c
                    )
                  )
                }}
              />
            )
          }

          return (
            <Card key={ch.type} className="relative">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {ch.name}
                    {!ch.available && (
                      <Badge variant="outline">Coming Soon</Badge>
                    )}
                    {saved?.enabled && (
                      <Badge variant="success">Connected</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">{ch.description}</CardDescription>
                </div>
              </div>

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
                {ch.available && ch.type !== "web" && (
                  <>
                    {isConfiguring ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => save(ch.type, true)}
                          disabled={saving}
                        >
                          {saving ? "Connecting..." : "Save & Connect"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setConfiguring(null)
                            setFormData({})
                            setStatusMessage(null)
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setConfiguring(ch.type)
                          setFormData(saved?.config || {})
                          setStatusMessage(null)
                        }}
                      >
                        {saved ? "Configure" : "Set Up"}
                      </Button>
                    )}
                    {saved?.enabled && !isConfiguring && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => save(ch.type, false)}
                      >
                        Disconnect
                      </Button>
                    )}
                  </>
                )}
                {ch.type === "web" && (
                  <Badge variant="success">Always Active</Badge>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
