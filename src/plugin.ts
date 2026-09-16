import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyReact } from './harnesses/react.js'

/** Cordis loader name for the fixed-harness selector plugin. */
export const name = 'harness-all-in-dsh'

/** The selector requires the system-prompt registry supplied by dsh-base. */
export const inject = ['systemPrompt']

/** Fixed Harness selection. More ids become valid only after their implementation lands. */
export interface Config {
  readonly harness?: 'react'
}

/** Load-time validation for the implemented Harness set. */
export const Config: z<Config> = z.object({
  harness: z.const('react').default('react'),
})

/**
 * Install the selected fixed Harness on the existing DSH Agent loop.
 *
 * @param ctx - Cordis application context.
 * @param config - Validated fixed-Harness selection.
 */
export function apply(ctx: Context, config: Config): void {
  switch (config.harness ?? 'react') {
    case 'react':
      applyReact(ctx)
      return
  }
}
