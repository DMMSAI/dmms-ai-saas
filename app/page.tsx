import Link from "next/link"

const channels = [
  "WhatsApp", "Telegram", "Discord", "Slack", "Signal", "LINE",
  "MS Teams", "Matrix", "IRC", "Twitch", "Nostr", "iMessage",
  "Google Chat", "Mattermost", "Zalo", "Web Chat",
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface-primary">
      {/* Nav */}
      <nav className="flex items-center justify-between border-b border-border-glass px-6 py-4 lg:px-12">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="DMMS AI" className="h-9 w-9 rounded-lg object-contain" />
          <span className="text-lg font-bold text-text-primary">DMMS AI</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-text-secondary hover:text-text-primary transition-colors">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-gradient-to-r from-teal-500 to-teal-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 hover:brightness-110 transition-all"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden px-6 py-24 lg:px-12 lg:py-32">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[500px] w-[500px] rounded-full bg-teal-500/10 blur-[120px]" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center rounded-full border border-teal-500/20 bg-teal-500/10 px-4 py-1.5 text-sm text-teal-400">
            Every Messenger is AI Now.
          </div>
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-text-primary sm:text-6xl lg:text-7xl">
            One AI.{" "}
            <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">
              Every Messenger.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary sm:text-xl">
            Connect WhatsApp, Telegram, Discord, Slack, and 12+ more platforms to a
            single, powerful AI assistant. Manage all your conversations from one dashboard.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/signup"
              className="rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-teal-500/25 hover:from-teal-600 hover:to-emerald-700 transition-all"
            >
              Start for Free
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-border-glass-strong px-8 py-3.5 text-base font-medium text-text-secondary hover:bg-surface-card hover:text-text-primary transition-all"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Channels Marquee */}
      <section className="border-y border-border-glass py-12">
        <p className="mb-8 text-center text-sm font-medium uppercase tracking-wider text-text-muted">
          Supported Platforms
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 px-6">
          {channels.map((ch) => (
            <span
              key={ch}
              className="rounded-full border border-border-glass bg-surface-card px-4 py-2 text-sm text-text-secondary"
            >
              {ch}
            </span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-3xl font-bold text-text-primary sm:text-4xl">
            Everything you need
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-text-secondary">
            A complete platform for managing AI-powered conversations across all your messaging channels.
          </p>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Multi-Channel",
                desc: "Connect 16+ messaging platforms. One AI handles them all with a unified conversation history.",
                icon: "M13 10V3L4 14h7v7l9-11h-7z",
              },
              {
                title: "Streaming AI",
                desc: "Real-time streaming responses powered by GPT-4o, with support for multiple AI providers.",
                icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z",
              },
              {
                title: "Dashboard",
                desc: "Monitor all conversations, manage channels, and configure your AI from a sleek web dashboard.",
                icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z",
              },
              {
                title: "Per-User Config",
                desc: "Each user brings their own API keys. Full multi-tenant isolation with individual channel configs.",
                icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
              },
              {
                title: "Extensible",
                desc: "Plugin-based architecture. Add new channels, AI providers, and tools without touching core code.",
                icon: "M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.491 48.491 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z",
              },
              {
                title: "Open Source",
                desc: "Built from scratch. Full transparency, no vendor lock-in. Self-host or use our cloud.",
                icon: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-border-glass bg-surface-card/80 backdrop-blur-sm p-6 transition-colors hover:bg-surface-secondary"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10">
                  <svg className="h-5 w-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={feature.icon} />
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-text-primary">{feature.title}</h3>
                <p className="text-sm text-text-secondary">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-3xl rounded-2xl border border-teal-500/20 bg-gradient-to-br from-teal-500/10 to-emerald-500/5 p-12 text-center">
          <h2 className="text-3xl font-bold text-text-primary">Ready to get started?</h2>
          <p className="mt-3 text-text-secondary">
            Create a free account and connect your first messenger in minutes.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-block rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 hover:brightness-110 transition-all"
          >
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-glass px-6 py-8 lg:px-12">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-sm text-text-muted">DMMS AI &copy; {new Date().getFullYear()}</span>
          <span className="text-sm text-text-muted/60">Every Messenger is AI Now.</span>
        </div>
      </footer>
    </div>
  )
}
