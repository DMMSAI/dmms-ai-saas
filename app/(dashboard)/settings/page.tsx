"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
  anthropic: "claude-sonnet-4-6",
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  anthropic: "Anthropic (Claude)",
}

/* ── SVG Provider Logos ──────────────────────────────────────────────── */

function OpenAILogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

function GeminiLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z" />
    </svg>
  )
}

function AnthropicLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm1.04 3.88L5.2 13.742h4.819L7.609 7.4z" />
    </svg>
  )
}

const PROVIDER_LOGOS: Record<string, React.FC<{ className?: string }>> = {
  openai: OpenAILogo,
  gemini: GeminiLogo,
  anthropic: AnthropicLogo,
}

export default function SettingsPage() {
  const { data: session } = useSession()
  const [openaiKey, setOpenaiKey] = useState("")
  const [geminiKey, setGeminiKey] = useState("")
  const [anthropicKey, setAnthropicKey] = useState("")
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({})
  const [savingOpenai, setSavingOpenai] = useState(false)
  const [savingGemini, setSavingGemini] = useState(false)
  const [savingAnthropic, setSavingAnthropic] = useState(false)
  const [activeProvider, setActiveProvider] = useState("openai")
  const [selectedModel, setSelectedModel] = useState("openai:gpt-4o")
  const [savingModel, setSavingModel] = useState(false)
  const [modelSaved, setModelSaved] = useState(false)
  const [activating, setActivating] = useState(false)

  useEffect(() => {
    fetch("/api/settings/apikeys")
      .then((r) => r.json())
      .then((data) => {
        setSavedKeys(data || {})
        if (data?.openai) setOpenaiKey("sk-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")
        if (data?.gemini) setGeminiKey("AI\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")
        if (data?.anthropic) setAnthropicKey("sk-ant-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")
      })
      .catch(() => {})

    fetch("/api/settings/model")
      .then((r) => r.json())
      .then((data) => {
        if (data?.aiProvider && data?.aiModel) {
          setActiveProvider(data.aiProvider)
          setSelectedModel(`${data.aiProvider}:${data.aiModel}`)
        }
      })
      .catch(() => {})
  }, [])

  const saveApiKey = async (provider: string, key: string, setSaving: (v: boolean) => void) => {
    if (!key || key.includes("\u2022\u2022")) return
    setSaving(true)
    try {
      await fetch("/api/settings/apikeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: key }),
      })
      setSavedKeys((prev) => ({ ...prev, [provider]: true }))
      if (provider === "openai") setOpenaiKey("sk-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")
      if (provider === "gemini") setGeminiKey("AI\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")
      if (provider === "anthropic") setAnthropicKey("sk-ant-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")
    } finally {
      setSaving(false)
    }
  }

  const activateProvider = async (provider: string) => {
    const defaultModel = DEFAULT_MODELS[provider]
    const value = `${provider}:${defaultModel}`
    setActivating(true)
    setActiveProvider(provider)
    setSelectedModel(value)
    try {
      await fetch("/api/settings/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiProvider: provider, aiModel: defaultModel }),
      })
    } finally {
      setActivating(false)
    }
  }

  const saveModel = async (value: string) => {
    setSelectedModel(value)
    setModelSaved(false)
    const [aiProvider, ...rest] = value.split(":")
    const aiModel = rest.join(":")
    setActiveProvider(aiProvider)
    setSavingModel(true)
    try {
      await fetch("/api/settings/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiProvider, aiModel }),
      })
      setModelSaved(true)
      setTimeout(() => setModelSaved(false), 2000)
    } finally {
      setSavingModel(false)
    }
  }

  const renderProviderCard = (
    provider: string,
    label: string,
    keyValue: string,
    setKey: (v: string) => void,
    saving: boolean,
    setSaving: (v: boolean) => void,
    placeholder: string,
    helpUrl: string,
    helpDomain: string
  ) => {
    const Logo = PROVIDER_LOGOS[provider]
    const isActive = activeProvider === provider
    return (
      <div
        key={provider}
        className={`rounded-2xl border p-5 transition-all duration-200 ${
          isActive
            ? "border-teal-500/30 bg-teal-500/[0.08] shadow-md shadow-teal-500/10"
            : "border-border-glass bg-surface-card opacity-60"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <label className="flex items-center gap-2.5 text-sm font-medium text-text-primary">
            {Logo && <Logo className="h-5 w-5" />}
            {label}
            {savedKeys[provider] && <Badge variant="success" className="text-[10px]">Saved</Badge>}
          </label>
          <button
            onClick={() => activateProvider(provider)}
            disabled={activating || isActive}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 focus:ring-offset-surface-card disabled:cursor-default ${
              isActive ? "bg-teal-500" : "bg-border-glass-strong"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                isActive ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            value={keyValue}
            onChange={(e) => {
              setKey(e.target.value)
              if (!e.target.value.includes("\u2022\u2022")) setSavedKeys((p) => ({ ...p, [provider]: false }))
            }}
            placeholder={placeholder}
            onFocus={() => {
              if (keyValue.includes("\u2022\u2022")) setKey("")
            }}
          />
          <Button
            onClick={() => saveApiKey(provider, keyValue, setSaving)}
            disabled={saving || !keyValue || keyValue.includes("\u2022\u2022")}
            size="sm"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Get your key from{" "}
          <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="text-teal-500 hover:underline">
            {helpDomain}
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary">Manage your account and AI configuration</p>
      </div>

      {/* Profile */}
      <Card>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your account information</CardDescription>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary">Email</label>
            <p className="text-sm text-text-primary">{session?.user?.email}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary">Name</label>
            <p className="text-sm text-text-primary">{session?.user?.name || "\u2014"}</p>
          </div>
        </div>
      </Card>

      {/* API Keys */}
      <Card>
        <CardTitle className="flex items-center gap-2">
          API Keys
          {(savedKeys.openai || savedKeys.gemini || savedKeys.anthropic) && <Badge variant="success">Configured</Badge>}
        </CardTitle>
        <CardDescription>
          Add your AI provider API keys and activate the one you want to use. Only one provider can be active at a time.
        </CardDescription>
        <div className="mt-4 space-y-4">
          {renderProviderCard("openai", "OpenAI", openaiKey, setOpenaiKey, savingOpenai, setSavingOpenai, "sk-...", "https://platform.openai.com/api-keys", "platform.openai.com")}
          {renderProviderCard("gemini", "Google Gemini", geminiKey, setGeminiKey, savingGemini, setSavingGemini, "AIza...", "https://aistudio.google.com/apikey", "aistudio.google.com")}
          {renderProviderCard("anthropic", "Anthropic (Claude)", anthropicKey, setAnthropicKey, savingAnthropic, setSavingAnthropic, "sk-ant-...", "https://console.anthropic.com/settings/keys", "console.anthropic.com")}
        </div>
      </Card>

      {/* AI Model */}
      <Card>
        <CardTitle className="flex items-center gap-2">
          AI Model
          {modelSaved && <Badge variant="success" className="text-[10px]">Saved</Badge>}
          {savingModel && <span className="text-xs text-text-muted">Saving...</span>}
        </CardTitle>
        <CardDescription>
          Select a model for the active provider: <span className="font-medium text-teal-400">{PROVIDER_LABELS[activeProvider]}</span>
        </CardDescription>
        <div className="mt-4 space-y-3">
          <select
            value={selectedModel}
            onChange={(e) => saveModel(e.target.value)}
            className="w-full rounded-xl border border-border-glass bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {activeProvider === "openai" && (
              <optgroup label="OpenAI">
                <option value="openai:gpt-5.2-chat-latest">GPT-5.2 (Latest)</option>
                <option value="openai:gpt-4o">GPT-4o (Recommended)</option>
                <option value="openai:gpt-4o-mini">GPT-4o Mini (Faster)</option>
              </optgroup>
            )}
            {activeProvider === "gemini" && (
              <optgroup label="Google Gemini">
                <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash (Fast)</option>
                <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro</option>
              </optgroup>
            )}
            {activeProvider === "anthropic" && (
              <optgroup label="Anthropic (Claude)">
                <option value="anthropic:claude-sonnet-4-6">Claude Sonnet 4.6 (Recommended)</option>
                <option value="anthropic:claude-haiku-4-5-20251001">Claude Haiku 4.5 (Fast)</option>
                <option value="anthropic:claude-opus-4-6">Claude Opus 4.6 (Most Capable)</option>
              </optgroup>
            )}
          </select>
          <p className="text-xs text-text-muted">
            This applies to web chat and new messenger conversations. Changes take effect immediately.
          </p>
        </div>
      </Card>
    </div>
  )
}
