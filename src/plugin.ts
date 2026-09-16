import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyFlashSearcher } from './harnesses/flash-searcher.js'
import { applyPlanAndExecute } from './harnesses/plan-and-execute.js'
import { applyReact } from './harnesses/react.js'
import { applyReSum } from './harnesses/resum.js'

/** Cordis loader name for the fixed-harness selector plugin. */
export const name = 'harness-all-in-dsh'

/** The selector requires the system-prompt registry supplied by dsh-base. */
export const inject = ['sessionProjections', 'systemPrompt', 'tools']

/** Fixed Harness selection. More ids become valid only after their implementation lands. */
export interface Config {
  readonly harness?: 'react' | 'plan-and-execute' | 'resum' | 'flash-searcher'
  readonly summaryInterval?: number
}

/** Load-time validation for the implemented Harness set. */
export const Config: z<Config> = z.object({
  harness: z.union(['react', 'plan-and-execute', 'resum', 'flash-searcher'] as const).default('react'),
  summaryInterval: z.number().default(8),
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
    case 'plan-and-execute':
      applyPlanAndExecute(ctx, { summaryInterval: config.summaryInterval ?? 8 })
      return
    case 'resum':
      applyReSum(ctx)
      return
    case 'flash-searcher':
      applyFlashSearcher(ctx, { summaryInterval: config.summaryInterval ?? 8 })
      return
  }
}
