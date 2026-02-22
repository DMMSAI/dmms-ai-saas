"use client"

import { useSession } from "next-auth/react"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { MessageCircle, Zap, Archive, Settings, Radio, MessagesSquare, BarChart3 } from "lucide-react"

const quickLinks = [
  { href: "/chat", label: "Chat Playground", desc: "Test your AI in the browser", icon: MessageCircle, color: "text-teal-400 bg-teal-500/10" },
  { href: "/channels", label: "Channels", desc: "Connect messengers", icon: Zap, color: "text-amber-400 bg-amber-500/10" },
  { href: "/conversations", label: "Conversations", desc: "View all chats", icon: Archive, color: "text-violet-400 bg-violet-500/10" },
  { href: "/settings", label: "Settings", desc: "API keys & preferences", icon: Settings, color: "text-sky-400 bg-sky-500/10" },
]

const statCards = [
  { label: "Connected Channels", value: "0", icon: Radio, color: "text-teal-400" },
  { label: "Conversations", value: "0", icon: MessagesSquare, color: "text-violet-400" },
  { label: "Messages Today", value: "0", icon: BarChart3, color: "text-amber-400" },
]

export default function DashboardPage() {
  const { data: session } = useSession()

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary">
          Welcome back{session?.user?.name ? `, ${session.user.name}` : ""}
        </h1>
        <p className="mt-1 text-text-secondary">Manage your AI channels and conversations.</p>
      </div>

      {/* Status Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label}>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-text-primary">{stat.value}</div>
                <Icon className={`h-5 w-5 ${stat.color}`} strokeWidth={1.5} />
              </div>
              <div className="mt-1 text-sm text-text-secondary">{stat.label}</div>
            </Card>
          )
        })}
        <Card>
          <div className="flex items-center justify-between">
            <Badge variant="success">Active</Badge>
          </div>
          <div className="mt-1 text-sm text-text-secondary">System Status</div>
        </Card>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Quick Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {quickLinks.map((link) => {
            const Icon = link.icon
            return (
              <Link key={link.href} href={link.href}>
                <Card className="flex items-start gap-4 transition-all hover:border-teal-500/20 hover:shadow-sm hover:shadow-teal-500/5">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${link.color}`}>
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div>
                    <CardTitle className="text-base">{link.label}</CardTitle>
                    <CardDescription>{link.desc}</CardDescription>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
