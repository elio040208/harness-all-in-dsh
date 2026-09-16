import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'

/** A model-visible policy contributed by one fixed Harness implementation. */
export interface HarnessPrompt {
  readonly id: string
  readonly text: string | ((context: AssembleContext) => string)
}

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
