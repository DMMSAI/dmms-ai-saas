"use client"

import { useState, useEffect } from "react"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface ChannelInfo {
  type: string
  name: string
  description: string
  configFields: { key: string; label: string; placeholder: string; type?: string }[]
  available: boolean
}

const CHANNELS: ChannelInfo[] = [
  {
    type: "web",
    name: "Web Chat",
    description: "Built-in browser chat — always available",
    configFields: [],
    available: true,
  },
  {
    type: "telegram",
    name: "Telegram",
    description: "Connect a Telegram bot",
    configFields: [{ key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF..." }],
    available: true,
  },
  {
    type: "discord",
    name: "Discord",
    description: "Connect a Discord bot",
    configFields: [{ key: "botToken", label: "Bot Token", placeholder: "Discord bot token" }],
    available: true,
  },
  {
    type: "slack",
    name: "Slack",
    description: "Connect via Slack Bot",
    configFields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-..." },
      { key: "appToken", label: "App Token", placeholder: "xapp-..." },
    ],
    available: false,
  },
  {
    type: "whatsapp",
    name: "WhatsApp",
    description: "WhatsApp via Baileys",
    configFields: [],
    available: false,
  },
  {
    type: "signal",
    name: "Signal",
    description: "Signal via signal-cli",
    configFields: [],
    available: false,
  },
  {
    type: "line",
    name: "LINE",
    description: "LINE Messaging API",
    configFields: [],
    available: false,
  },
  {
    type: "matrix",
    name: "Matrix",
    description: "Matrix (Element, etc.)",
    configFields: [],
    available: false,
  },
  {
    type: "msteams",
    name: "MS Teams",
    description: "Microsoft Teams Bot",
    configFields: [],
    available: false,
  },
  {
    type: "irc",
    name: "IRC",
    description: "IRC via irc-framework",
    configFields: [],
    available: false,
  },
  {
    type: "twitch",
    name: "Twitch",
    description: "Twitch Chat",
    configFields: [],
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
        // Parse config strings
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
      // Save channel config
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelType, config: formData, enabled }),
      })
      const updated = await res.json()

      // Parse config if it's a string
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
        // Unregister webhook when disabling
        await fetch("/api/channels/telegram/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unregister" }),
        })
        setStatusMessage({ type: "success", text: "Telegram disconnected." })
      } else {
        setStatusMessage({ type: "success", text: "Channel saved!" })
      }

      setConfiguring(null)
      setFormData({})
    } catch (err) {
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
          Connect messaging platforms to your AI assistant
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
