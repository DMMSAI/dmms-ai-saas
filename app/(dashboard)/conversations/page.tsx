"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"

interface Conversation {
  id: string
  channelType: string
  title: string
  aiModel: string
  createdAt: string
  updatedAt: string
  _count: { messages: number }
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        setConversations(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const deleteConvo = async (id: string) => {
    await fetch("/api/conversations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    setConversations((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Conversations</h1>
        <p className="text-sm text-text-secondary">Monitor all conversations across channels</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
        </div>
      ) : conversations.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-text-muted">No conversations yet. Start chatting!</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {conversations.map((convo) => (
            <Card key={convo.id} className="flex items-center justify-between p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-text-primary">{convo.title}</span>
                  <Badge variant="outline">{convo.channelType}</Badge>
                  <Badge variant="default">{convo.aiModel}</Badge>
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {convo._count.messages} messages &middot; Last active{" "}
                  {new Date(convo.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteConvo(convo.id)}>
                <Trash2 className="h-4 w-4 text-text-muted" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
