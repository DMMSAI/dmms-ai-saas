import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "discord.js",
    "grammy",
    "@slack/bolt",
    "socket.io",
    "bcryptjs",
    "pg",
    "openai",
    "@google/genai",
    "@whiskeysockets/baileys",
    "qrcode",
    "pino",
    "wechaty",
    "wechaty-puppet-wechat4u",
  ],
}

export default nextConfig
