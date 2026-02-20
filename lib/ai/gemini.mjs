/**
 * DMMS AI — Google Gemini Provider
 * Handles Gemini chat completions with function calling support.
 */

import { GoogleGenAI } from "@google/genai"
import { TOOLS, executeTool } from "./tools.mjs"

/**
 * Convert OpenAI-format messages to Gemini format.
 * Gemini uses: role "user" or "model", and parts: [{ text }]
 * System messages are passed via systemInstruction.
 */
function toGeminiContents(messages) {
  const contents = []
  for (const msg of messages) {
    if (msg.role === "system") continue // handled separately
    if (msg.role === "tool") continue // handled in function response below

    const role = msg.role === "assistant" ? "model" : "user"
    contents.push({ role, parts: [{ text: msg.content }] })
  }
  return contents
}

/**
 * Convert OpenAI tool definitions to Gemini function declarations.
 */
function toGeminiFunctionDeclarations() {
  return TOOLS.map((t) => ({
    name: t.definition.function.name,
    description: t.definition.function.description,
    parameters: t.definition.function.parameters,
  }))
}

/**
 * Call Gemini with messages, supporting multi-round function calls.
 * @param {string} apiKey - Google AI API key
 * @param {Array} messages - OpenAI-format messages [{role, content}]
 * @param {string} model - Model name (default: gemini-2.5-flash)
 * @param {object} opts - { onTyping }
 * @returns {{ reply: string, toolsUsed: string[] }}
 */
export async function callGemini(apiKey, messages, model = "gemini-2.5-flash", opts = {}) {
  const ai = new GoogleGenAI({ apiKey })

  // Extract system instruction
  const systemMsg = messages.find((m) => m.role === "system")
  const systemInstruction = systemMsg?.content || ""

  const functionDeclarations = toGeminiFunctionDeclarations()
  const toolsUsed = []
  const maxRounds = 3
  let round = 0

  // Build initial contents
  const contents = toGeminiContents(messages)

  while (round < maxRounds) {
    round++

    console.log(`[AI:Gemini] Round ${round} — sending to ${model}...`)

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 2048,
        tools: functionDeclarations.length > 0
          ? [{ functionDeclarations }]
          : undefined,
      },
    })

    // Check for function calls
    const candidate = response.candidates?.[0]
    const parts = candidate?.content?.parts || []

    const functionCalls = parts.filter((p) => p.functionCall)

    if (functionCalls.length > 0) {
      // Add model response to contents
      contents.push({ role: "model", parts })

      // Execute each function call
      const functionResponses = []
      for (const part of functionCalls) {
        const { name, args } = part.functionCall

        console.log(`[AI:Gemini] Function call: ${name}(${JSON.stringify(args).slice(0, 80)})`)

        let result
        try {
          if (opts.onTyping) opts.onTyping()
          result = await executeTool(name, args || {})
          toolsUsed.push(name)
        } catch (err) {
          console.error(`[AI:Gemini] Tool error (${name}):`, err.message)
          result = `Error: ${err.message}`
        }

        functionResponses.push({
          functionResponse: {
            name,
            response: { result },
          },
        })
      }

      // Add function responses
      contents.push({ role: "user", parts: functionResponses })
      continue
    }

    // Extract text response
    const textParts = parts.filter((p) => p.text)
    const reply = textParts.map((p) => p.text).join("") || "Sorry, I couldn't generate a response."

    return { reply, toolsUsed }
  }

  return { reply: "Sorry, I took too long thinking. Please try again.", toolsUsed }
}
