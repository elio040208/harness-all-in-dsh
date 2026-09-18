import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyAgentFold } from './harnesses/agentfold.js'
import { applyAOrchestra } from './harnesses/aorchestra.js'
import { applyAggAgent } from './harnesses/aggagent.js'
import { applyDeepAgent } from './harnesses/deepagent.js'
import { applyFlashSearcher } from './harnesses/flash-searcher.js'
import { applyGam } from './harnesses/gam.js'
import { applyHiAgent } from './harnesses/hiagent.js'
import { applyMemoBrain } from './harnesses/memobrain.js'
import { applyOAgent } from './harnesses/oagent.js'
import { applyPlanAndExecute } from './harnesses/plan-and-execute.js'
import { applyReact } from './harnesses/react.js'
import { applyReSum } from './harnesses/resum.js'
import { applyRoma } from './harnesses/roma.js'

/** Cordis loader name for the fixed-harness selector plugin. */
export const name = 'harness-all-in-dsh'

/** The selector requires the system-prompt registry supplied by dsh-base. */
export const inject = ['sessionProjections', 'systemPrompt', 'tools']

/** Fixed Harness selection. More ids become valid only after their implementation lands. */
export interface Config {
  readonly harness?: 'react' | 'plan-and-execute' | 'resum' | 'flash-searcher' | 'gam' | 'memobrain' | 'aggagent' | 'oagent' | 'agentfold' | 'hiagent' | 'deepagent' | 'roma' | 'aorchestra'
  readonly summaryInterval?: number
  readonly reorgInterval?: number
  readonly memoryThresholdRatio?: number
  readonly auxiliaryMaxTokens?: number
  readonly rolloutCount?: number
  readonly subagentProvider?: string
  readonly criticMaxTokens?: number
  readonly controllerReminderLimit?: number
  readonly hiAgentMemorySize?: number
  readonly deepAgentMaxFolds?: number
  readonly romaMaxDepth?: number
  readonly romaMaxNodes?: number
  readonly romaMaxChildren?: number
  readonly romaMaxParallel?: number
  readonly aorchestraModels?: string
  readonly aorchestraModelProvider?: string
  readonly aorchestraMaxDelegations?: number
}

/** Load-time validation for the implemented Harness set. */
export const Config: z<Config> = z.object({
  harness: z.union(['react', 'plan-and-execute', 'resum', 'flash-searcher', 'gam', 'memobrain', 'aggagent', 'oagent', 'agentfold', 'hiagent', 'deepagent', 'roma', 'aorchestra'] as const).default('react'),
  summaryInterval: z.number().default(8),
  reorgInterval: z.number().default(4),
  memoryThresholdRatio: z.number().default(0.25),
  auxiliaryMaxTokens: z.number().default(8192),
  rolloutCount: z.number().default(4),
  subagentProvider: z.string().default('spawn'),
  criticMaxTokens: z.number().default(4096),
  controllerReminderLimit: z.number().default(2),
  hiAgentMemorySize: z.number().default(15),
  deepAgentMaxFolds: z.number().default(3),
  romaMaxDepth: z.number().default(2),
  romaMaxNodes: z.number().default(15),
  romaMaxChildren: z.number().default(4),
  romaMaxParallel: z.number().default(4),
  aorchestraModels: z.string().default('deepseek-v4.1-flash'),
  aorchestraModelProvider: z.string().default(''),
  aorchestraMaxDelegations: z.number().default(5),
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
    case 'oagent':
      ctx.inject(['subagents', 'llm'], ready => {
        applyOAgent(ready, {
          rolloutCount: config.rolloutCount ?? 4,
          provider: config.subagentProvider ?? 'spawn',
          criticMaxTokens: config.criticMaxTokens ?? 4096,
          controllerReminderLimit: config.controllerReminderLimit ?? 2,
        })
      })
      return
    case 'agentfold':
      applyAgentFold(ctx)
      return
    case 'hiagent':
      applyHiAgent(ctx, { memorySize: config.hiAgentMemorySize ?? 15 })
      return
    case 'deepagent':
      ctx.inject(['llm'], ready => {
        applyDeepAgent(ready, { maxFolds: config.deepAgentMaxFolds ?? 3, auxiliaryMaxTokens: config.auxiliaryMaxTokens ?? 8192 })
      })
      return
    case 'roma':
      ctx.inject(['subagents', 'llm'], ready => {
        applyRoma(ready, {
          provider: config.subagentProvider ?? 'spawn',
          maxDepth: config.romaMaxDepth ?? 2,
          maxNodes: config.romaMaxNodes ?? 15,
          maxChildren: config.romaMaxChildren ?? 4,
          maxParallel: config.romaMaxParallel ?? 4,
          auxiliaryMaxTokens: config.auxiliaryMaxTokens ?? 8192,
          controllerReminderLimit: config.controllerReminderLimit ?? 2,
        })
      })
      return
    case 'aorchestra':
      ctx.inject(['subagents'], ready => {
        applyAOrchestra(ready, {
          subagentProvider: config.subagentProvider ?? 'spawn',
          modelProvider: config.aorchestraModelProvider ?? '',
          models: (config.aorchestraModels ?? 'deepseek-v4.1-flash').split(',').map(model => model.trim()).filter(Boolean),
          maxDelegations: config.aorchestraMaxDelegations ?? 5,
          controllerReminderLimit: config.controllerReminderLimit ?? 2,
        })
      })
      return
  }
}
