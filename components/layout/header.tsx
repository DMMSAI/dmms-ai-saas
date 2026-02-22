"use client"

import { signOut, useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"

export function Header() {
  const { data: session } = useSession()

  return (
    <header className="flex h-16 items-center justify-between border-b border-border-glass bg-surface-secondary/80 backdrop-blur-xl px-6">
      <div />
      <div className="flex items-center gap-4">
        {session?.user && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 text-xs font-semibold text-white shadow-md shadow-teal-500/20">
                {(session.user.name?.[0] || session.user.email?.[0] || "U").toUpperCase()}
              </div>
              <span className="text-sm text-text-secondary">
                {session.user.name || session.user.email}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>
              <LogOut className="mr-1.5 h-4 w-4" />
              Sign out
            </Button>
          </>
        )}
      </div>
    </header>
  )
}
