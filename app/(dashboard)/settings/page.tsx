"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

export default function SettingsPage() {
  const { data: session } = useSession()
  const [openaiKey, setOpenaiKey] = useState("")
  const [geminiKey, setGeminiKey] = useState("")
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({})
  const [savingOpenai, setSavingOpenai] = useState(false)
  const [savingGemini, setSavingGemini] = useState(false)

  useEffect(() => {
    fetch("/api/settings/apikeys")
      .then((r) => r.json())
      .then((data) => {
        setSavedKeys(data || {})
        if (data?.openai) setOpenaiKey("sk-••••••••••••••••")
        if (data?.gemini) setGeminiKey("AI••••••••••••••••")
      })
      .catch(() => {})
  }, [])

  const saveApiKey = async (provider: string, key: string, setSaving: (v: boolean) => void) => {
    if (!key || key.includes("••")) return
    setSaving(true)
    try {
      await fetch("/api/settings/apikeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: key }),
      })
      setSavedKeys((prev) => ({ ...prev, [provider]: true }))
      if (provider === "openai") setOpenaiKey("sk-••••••••••••••••")
      if (provider === "gemini") setGeminiKey("AI••••••••••••••••")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-400">Manage your account and AI configuration</p>
      </div>

      {/* Profile */}
      <Card>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your account information</CardDescription>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-zinc-400">Email</label>
            <p className="text-sm text-zinc-200">{session?.user?.email}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-400">Name</label>
            <p className="text-sm text-zinc-200">{session?.user?.name || "—"}</p>
          </div>
        </div>
      </Card>

      {/* API Keys */}
      <Card>
        <CardTitle className="flex items-center gap-2">
          API Keys
          {(savedKeys.openai || savedKeys.gemini) && <Badge variant="success">Configured</Badge>}
        </CardTitle>
        <CardDescription>
          Add your AI provider API keys. Keys are stored securely.
        </CardDescription>
        <div className="mt-4 space-y-6">
          {/* OpenAI */}
          <div>
            <label className="mb-1 flex items-center gap-2 text-xs font-medium text-zinc-400">
              OpenAI API Key
              {savedKeys.openai && <Badge variant="success" className="text-[10px]">Saved</Badge>}
            </label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={openaiKey}
                onChange={(e) => {
                  setOpenaiKey(e.target.value)
                  if (!e.target.value.includes("••")) setSavedKeys((p) => ({ ...p, openai: false }))
                }}
                placeholder="sk-..."
                onFocus={() => {
                  if (openaiKey.includes("••")) setOpenaiKey("")
                }}
              />
              <Button
                onClick={() => saveApiKey("openai", openaiKey, setSavingOpenai)}
                disabled={savingOpenai || !openaiKey || openaiKey.includes("••")}
              >
                {savingOpenai ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Get your key from{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-teal-500 hover:underline">
                platform.openai.com
              </a>
            </p>
          </div>

          {/* Gemini */}
          <div>
            <label className="mb-1 flex items-center gap-2 text-xs font-medium text-zinc-400">
              Google Gemini API Key
              {savedKeys.gemini && <Badge variant="success" className="text-[10px]">Saved</Badge>}
            </label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={geminiKey}
                onChange={(e) => {
                  setGeminiKey(e.target.value)
                  if (!e.target.value.includes("••")) setSavedKeys((p) => ({ ...p, gemini: false }))
                }}
                placeholder="AIza..."
                onFocus={() => {
                  if (geminiKey.includes("••")) setGeminiKey("")
                }}
              />
              <Button
                onClick={() => saveApiKey("gemini", geminiKey, setSavingGemini)}
                disabled={savingGemini || !geminiKey || geminiKey.includes("••")}
              >
                {savingGemini ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Get your key from{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-teal-500 hover:underline">
                aistudio.google.com
              </a>
            </p>
          </div>
        </div>
      </Card>

      {/* AI Model */}
      <Card>
        <CardTitle>AI Model</CardTitle>
        <CardDescription>Select your default AI provider and model</CardDescription>
        <div className="mt-4 space-y-3">
          <select className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-teal-500">
            <optgroup label="OpenAI">
              <option value="openai:gpt-5.2-chat-latest">GPT-5.2 (Latest)</option>
              <option value="openai:gpt-4o">GPT-4o (Recommended)</option>
              <option value="openai:gpt-4o-mini">GPT-4o Mini (Faster)</option>
            </optgroup>
            <optgroup label="Google Gemini">
              <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash (Fast)</option>
              <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro</option>
            </optgroup>
          </select>
          <p className="text-xs text-zinc-500">
            This applies to web chat. Messenger channels use the model configured at the time of conversation creation.
          </p>
        </div>
      </Card>
    </div>
  )
}
