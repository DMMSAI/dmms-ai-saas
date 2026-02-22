"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Send, MessageCircle, Plus } from "lucide-react"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState("openai:gpt-4o")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Load user's default model from settings
  useEffect(() => {
    fetch("/api/settings/model")
      .then((r) => r.json())
      .then((data) => {
        if (data?.aiProvider && data?.aiModel) {
          setSelectedModel(`${data.aiProvider}:${data.aiModel}`)
        }
      })
      .catch(() => {})
  }, [])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput("")
    setIsStreaming(true)

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text }
    setMessages((prev) => [...prev, userMsg])

    const assistantId = crypto.randomUUID()
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }])

    // Parse provider and model from selection
    const [aiProvider, ...modelParts] = selectedModel.split(":")
    const model = modelParts.join(":")

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId, aiProvider, model }),
      })

      if (!res.ok) {
        const err = await res.json()
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${err.error}` } : m
          )
        )
        setIsStreaming(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) return

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        const lines = text.split("\n\n").filter(Boolean)

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === "text") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + data.content } : m
                )
              )
            }
            if (data.type === "end" && data.conversationId) {
              setConversationId(data.conversationId)
            }
            if (data.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `Error: ${data.error}` }
                    : m
                )
              )
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Error: ${err instanceof Error ? err.message : "Network error"}` }
            : m
        )
      )
    } finally {
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const newChat = () => {
    setMessages([])
    setConversationId(null)
  }

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      {/* Header */}
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Chat Playground</h1>
          <p className="text-sm text-text-secondary">Test your AI assistant</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="rounded-xl border border-border-glass bg-surface-card px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <optgroup label="OpenAI">
              <option value="openai:gpt-5.2-chat-latest">GPT-5.2</option>
              <option value="openai:gpt-4o">GPT-4o</option>
              <option value="openai:gpt-4o-mini">GPT-4o Mini</option>
            </optgroup>
            <optgroup label="Gemini">
              <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro</option>
            </optgroup>
            <optgroup label="Claude">
              <option value="anthropic:claude-sonnet-4-6">Claude Sonnet 4.6</option>
              <option value="anthropic:claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
              <option value="anthropic:claude-opus-4-6">Claude Opus 4.6</option>
            </optgroup>
          </select>
          <Button variant="outline" size="sm" onClick={newChat}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Chat
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto rounded-2xl border border-border-glass bg-surface-card/50 p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-text-muted">
            <MessageCircle className="mb-4 h-12 w-12 text-text-muted/50" strokeWidth={1} />
            <p className="text-lg font-medium text-text-secondary">Start a conversation</p>
            <p className="text-sm">Type a message below to begin chatting with DMMS AI</p>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-3 text-sm",
                  msg.role === "user"
                    ? "bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/25"
                    : "bg-surface-card text-text-primary border border-border-glass"
                )}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                {msg.role === "assistant" && !msg.content && isStreaming && (
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: "0ms" }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: "150ms" }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: "300ms" }} />
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border-glass bg-surface-card px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
        />
        <Button onClick={sendMessage} disabled={isStreaming || !input.trim()}>
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  )
}
