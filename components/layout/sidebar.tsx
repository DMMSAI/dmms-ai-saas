"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, MessageCircle, Zap, Archive, Settings } from "lucide-react"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/channels", label: "Channels", icon: Zap },
  { href: "/conversations", label: "Conversations", icon: Archive },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="sidebar-bg flex h-full w-64 flex-col border-r border-border-glass">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-border-glass px-6">
        <img src="/logo.png" alt="DMMS AI" className="h-8 w-8 rounded-lg object-contain" />
        <span className="text-lg font-bold text-text-primary">DMMS AI</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-teal-500/15 text-teal-400 shadow-sm shadow-teal-500/10"
                  : "text-text-secondary hover:bg-surface-card hover:text-text-primary"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.5} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Version */}
      <div className="border-t border-border-glass p-4">
        <div className="text-xs text-text-muted">DMMS AI v1.0</div>
      </div>
    </aside>
  )
}
