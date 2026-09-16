import type { Context } from '@deepseek-ai/cordis'
import { registerHarnessPrompt } from '../runtime/prompt.js'

/** ReAct policy adapted from the official prompt to DSH native tool calls. */
export const REACT_PROMPT = `Operate as a ReAct agent.

For each step, reason about the current task and all observations retained in the conversation, then either call an available tool or provide the final answer. After every tool result, inspect that observation before choosing the next action. Continue interleaving reasoning, action, and observation until the task is complete.

Do not create a separate up-front plan, delegate the task to another agent, or summarize and replace earlier history. Use the available task tools directly. Provide a final answer only when the accumulated observations support it.`

/** Install the DSH-native ReAct policy. */
export function applyReact(ctx: Context): void {
  registerHarnessPrompt(ctx, { id: 'react', text: REACT_PROMPT })
}
