/**
 * DMMS AI — OpenAI Provider
 * Handles OpenAI GPT chat completions with tool/function calling support.
 */

import OpenAI from "openai"
import { TOOLS, executeTool } from "./tools.mjs"

/**
 * Call OpenAI with messages, supporting multi-round tool calls.
 * @param {string} apiKey - OpenAI API key
 * @param {Array} messages - OpenAI-format messages [{role, content}]
 * @param {string} model - Model name (default: gpt-5.2-chat-latest)
 * @param {object} opts - { onTyping }
 * @returns {{ reply: string, toolsUsed: string[] }}
 */
export async function callOpenAI(apiKey, messages, model = "gpt-5.2-chat-latest", opts = {}) {
  const openai = new OpenAI({ apiKey })

  const tools = TOOLS.map((t) => t.definition)
  const maxRounds = 3
  let round = 0
  const toolsUsed = []
  let reply = null

  // Clone messages array to avoid mutating caller's copy
  const msgs = [...messages]

  while (round < maxRounds) {
    round++

    const params = {
      model,
      messages: msgs,
      temperature: 0.7,
      max_completion_tokens: 2048,
    }

    if (tools.length > 0) {
      params.tools = tools
      params.tool_choice = "auto"
    }

    console.log(`[AI:OpenAI] Round ${round} — sending to ${model}...`)
    const completion = await openai.chat.completions.create(params)
    const choice = completion.choices[0]

    if (choice.finish_reason === "tool_calls" || choice.message.tool_calls?.length > 0) {
      msgs.push(choice.message)

      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function.name
        const toolArgs = JSON.parse(toolCall.function.arguments || "{}")

        console.log(`[AI:OpenAI] Tool call: ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)})`)

        let result
        try {
          if (opts.onTyping) opts.onTyping()
          result = await executeTool(toolName, toolArgs)
          toolsUsed.push(toolName)
        } catch (err) {
          console.error(`[AI:OpenAI] Tool error (${toolName}):`, err.message)
          result = `Error: ${err.message}`
        }

        msgs.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        })
      }
      continue
    }

    reply = choice.message.content || "Sorry, I couldn't generate a response."
    break
  }

  if (!reply) {
    reply = "Sorry, I took too long thinking. Please try again."
  }

  return { reply, toolsUsed }
}
