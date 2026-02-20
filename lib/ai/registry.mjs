/**
 * DMMS AI — AI Provider Registry
 * Routes AI calls to the appropriate provider (OpenAI, Gemini, etc.)
 */

import { callOpenAI } from "./openai.mjs"
import { callGemini } from "./gemini.mjs"

/**
 * Default models per provider
 */
const DEFAULT_MODELS = {
  openai: "gpt-5.2-chat-latest",
  gemini: "gemini-2.5-flash",
}

/**
 * Call the appropriate AI provider.
 * @param {string} provider - "openai" or "gemini"
 * @param {string} apiKey - API key for the provider
 * @param {Array} messages - OpenAI-format messages [{role, content}]
 * @param {string} [model] - Override model name
 * @param {object} [opts] - { onTyping }
 * @returns {{ reply: string, toolsUsed: string[] }}
 */
export async function callAI(provider, apiKey, messages, model, opts = {}) {
  const resolvedModel = model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai

  switch (provider) {
    case "gemini":
      return callGemini(apiKey, messages, resolvedModel, opts)

    case "openai":
    default:
      return callOpenAI(apiKey, messages, resolvedModel, opts)
  }
}

export { DEFAULT_MODELS }
