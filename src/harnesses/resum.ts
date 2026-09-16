import type { Context } from '@deepseek-ai/cordis'
import { registerHarnessPrompt } from '../runtime/prompt.js'

/** ReSum policy adapted from WebResummer to DSH-native tool calls and compaction. */
export const RESUM_PROMPT = `Operate as a ReSum agent.

Use a direct ReAct action/observation loop: reason from the current task and observations, call the smallest useful set of available tools, inspect their results, and continue until the task is resolved. Do not create a separate up-front plan or delegate the task.

Long runs use automatic ReSum checkpoints. When earlier conversation has been replaced by a compacted summary, treat the summary as established evidence and working state. Preserve its confirmed facts, unresolved information gaps, and next-step directions while continuing the investigation. Do not try to reconstruct discarded wording or repeat completed work unless verification is necessary.

Provide the final answer only when the retained evidence supports it.`

/** Install the DSH-native ReSum execution policy. */
export function applyReSum(ctx: Context): void {
  registerHarnessPrompt(ctx, { id: 'resum', text: RESUM_PROMPT })
}
