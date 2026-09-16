import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyAggAgent } from './harnesses/aggagent.js'
import { applyFlashSearcher } from './harnesses/flash-searcher.js'
import { applyGam } from './harnesses/gam.js'
import { applyMemoBrain } from './harnesses/memobrain.js'
import { applyPlanAndExecute } from './harnesses/plan-and-execute.js'
import { applyReact } from './harnesses/react.js'
import { applyReSum } from './harnesses/resum.js'

/** Cordis loader name for the fixed-harness selector plugin. */
export const name = 'harness-all-in-dsh'

/** The selector requires the system-prompt registry supplied by dsh-base. */
export const inject = ['sessionProjections', 'systemPrompt', 'tools']

/** Fixed Harness selection. More ids become valid only after their implementation lands. */
export interface Config {
  readonly harness?: 'react' | 'plan-and-execute' | 'resum' | 'flash-searcher' | 'gam' | 'memobrain' | 'aggagent'
  readonly summaryInterval?: number
  readonly reorgInterval?: number
  readonly memoryThresholdRatio?: number
  readonly auxiliaryMaxTokens?: number
  readonly rolloutCount?: number
  readonly subagentProvider?: string
}

/** Load-time validation for the implemented Harness set. */
export const Config: z<Config> = z.object({
  harness: z.union(['react', 'plan-and-execute', 'resum', 'flash-searcher', 'gam', 'memobrain', 'aggagent'] as const).default('react'),
  summaryInterval: z.number().default(8),
  reorgInterval: z.number().default(4),
  memoryThresholdRatio: z.number().default(0.25),
  auxiliaryMaxTokens: z.number().default(8192),
  rolloutCount: z.number().default(4),
  subagentProvider: z.string().default('spawn'),
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
    case 'gam':
      applyGam(ctx, { summaryInterval: config.summaryInterval ?? 8, reorgInterval: config.reorgInterval ?? 4 })
      return
    case 'memobrain':
      ctx.inject(['llm', 'tokenMeter'], (ready) => {
        applyMemoBrain(ready, {
          thresholdRatio: config.memoryThresholdRatio ?? 0.25,
          auxiliaryMaxTokens: config.auxiliaryMaxTokens ?? 8192,
        })
      })
      return
    case 'aggagent':
      ctx.inject(['subagents'], ready => {
        applyAggAgent(ready, {
          rolloutCount: config.rolloutCount ?? 4,
          provider: config.subagentProvider ?? 'spawn',
        })
      })
      return
  }
}
