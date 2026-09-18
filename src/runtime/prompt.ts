import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'

/** A model-visible policy contributed by one fixed Harness implementation. */
export interface HarnessPrompt {
  readonly id: string
  readonly text: string | ((context: AssembleContext) => string)
}

/** Replayable per-step state supplied outside the stable Harness policy. */
export interface HarnessContext {
  readonly id: string
  readonly text: string | ((context: AssembleContext) => string)
}

/** Stable recovery and completion policy shared by root and child Agents. */
export const EXECUTION_DISCIPLINE_PROMPT = `Treat failed task-tool results as observations about that method, not as evidence about the task answer. Do not repeat an identical failed call unless relevant state has changed. After the same tool, target, or route fails twice, change the tool, source, query, or strategy. Track the task's explicit success criteria; once they are supported by adequate evidence, stop using tools and return the result. Seek more confirmation only when it can resolve a material uncertainty.`

/**
 * Register one fixed Harness policy in the shared system-prompt registry.
 *
 * @param ctx - Cordis context containing the DSH system-prompt service.
 * @param prompt - Stable section id and policy text.
 * @returns the registration disposer owned by the calling plugin fiber.
 */
export function registerHarnessPrompt(ctx: Context, prompt: HarnessPrompt): () => void {
  return ctx.systemPrompt.section({
    name: `harness-all-in-dsh:${prompt.id}`,
    order: 125,
    text: prompt.text,
  })
}

/**
 * Register dynamic Harness state as a durable runtime-context snapshot.
 *
 * @param ctx - Cordis context containing the DSH system-prompt service.
 * @param context - Stable context id and replayable state renderer.
 * @returns the registration disposer owned by the calling plugin fiber.
 */
export function registerHarnessContext(ctx: Context, context: HarnessContext): () => void {
  return ctx.systemPrompt.context({
    name: `harness-all-in-dsh:${context.id}:state`,
    order: 125,
    text: context.text,
  })
}
