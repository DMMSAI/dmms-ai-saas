import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Providers } from "@/components/providers"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "DMMS AI — Every Messenger is AI Now",
  description: "Multi-messenger AI platform. Connect WhatsApp, Telegram, Discord, Slack, and more to a unified AI assistant.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-surface-primary text-text-primary antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
