import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { contentText } from '../runtime/content.js'
import { registerHarnessPrompt } from '../runtime/prompt.js'
import { foldToolEpisodes, initialToolEpisodeCollection } from '../runtime/tool-episodes.js'
import type { ToolEpisode, ToolEpisodeCollection } from '../runtime/tool-episodes.js'

const HIAGENT_SOURCE = 'harness-all-in-dsh:hiagent'

/** Host projection key for HiAgent's complete replayable trajectory. */
export const HIAGENT_PROJECTION_KEY = 'harness-all-in-dsh/hiagent' as const

/** Session-derived full trajectory and sampled-surface progress. */
export interface HiAgentState extends ToolEpisodeCollection {
  readonly originalTask: string | null
  readonly surfacedInteractions: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** HiAgent complete trajectory retained behind the sampled working surface. */
    [HIAGENT_PROJECTION_KEY]: HiAgentState
  }
}

const actionSchema = z.object({ tool: z.string(), arguments: z.string(), result: z.string(), isError: z.boolean() })
const interactionSchema = z.object({
  id: z.number().int().nonnegative(), agentStep: z.number().int().nonnegative(), explanation: z.string(),
  actions: z.array(actionSchema), relatedSeqs: z.array(z.number().int().nonnegative()),
})
const stateSchema: z.ZodType<HiAgentState> = z.object({
  originalTask: z.string().nullable(), interactions: z.array(interactionSchema),
  assistants: z.record(z.string(), z.object({ text: z.string(), seq: z.number().int().nonnegative() })),
  calls: z.record(z.string(), z.object({
    step: z.number().int().nonnegative(), tool: z.string(), arguments: z.string(), seq: z.number().int().nonnegative(),
  })),
  results: z.record(z.string(), z.object({ result: z.string(), isError: z.boolean(), seq: z.number().int().nonnegative() })),
  surfacedInteractions: z.number().int().nonnegative(),
})

/** Create the empty HiAgent trajectory state. */
export function initialHiAgentState(): HiAgentState {
  return { originalTask: null, surfacedInteractions: 0, ...initialToolEpisodeCollection() }
}

/** Pure Session-event fold for HiAgent's complete trajectory. */
export function foldHiAgentState(state: HiAgentState, event: SessionEvent): HiAgentState {
  if (event.type === 'user/message') {
    if (event.data.source.kind === 'user' && state.originalTask === null) return { ...state, originalTask: contentText(event.data.content) }
    if (event.data.source.kind === 'plugin' && event.data.source.plugin === HIAGENT_SOURCE) {
      return { ...state, surfacedInteractions: state.interactions.length }
    }
    return state
  }
  return foldToolEpisodes(state, event)
}

/** Durable HiAgent trajectory projection. */
export const hiAgentProjectionDefinition = {
  key: HIAGENT_PROJECTION_KEY, stateSchema, init: initialHiAgentState, apply: foldHiAgentState, stateVersion: 1,
} satisfies ProjectionDefinition<typeof HIAGENT_PROJECTION_KEY, HiAgentState>

function terms(text: string): readonly string[] {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []
}

/** Compute the two-document TF-IDF cosine similarity used for observation novelty. */
export function hiAgentSimilarity(left: string, right: string): number {
  const leftTerms = terms(left)
  const rightTerms = terms(right)
  if (leftTerms.length === 0 || rightTerms.length === 0) return 0
  const leftCounts = new Map<string, number>()
  const rightCounts = new Map<string, number>()
  for (const term of leftTerms) leftCounts.set(term, (leftCounts.get(term) ?? 0) + 1)
  for (const term of rightTerms) rightCounts.set(term, (rightCounts.get(term) ?? 0) + 1)
  const vocabulary = new Set([...leftCounts.keys(), ...rightCounts.keys()])
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (const term of vocabulary) {
    const documentFrequency = Number(leftCounts.has(term)) + Number(rightCounts.has(term))
    const idf = Math.log(3 / (1 + documentFrequency)) + 1
    const leftWeight = (leftCounts.get(term) ?? 0) * idf
    const rightWeight = (rightCounts.get(term) ?? 0) * idf
    dot += leftWeight * rightWeight
    leftNorm += leftWeight ** 2
    rightNorm += rightWeight ** 2
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm)
}

function observation(interaction: ToolEpisode): string {
  return interaction.actions.map(action => action.result).join('\n')
}

/** Select official-code top-K interactions, always retaining the first and latest. */
export function selectHiAgentInteractions(interactions: readonly ToolEpisode[], memorySize: number): ReadonlySet<number> {
  if (!Number.isSafeInteger(memorySize) || memorySize < 2) throw new Error('hiagent memorySize must be a safe integer of at least 2')
  if (interactions.length <= memorySize) return new Set(interactions.map(interaction => interaction.id))
  const middle = interactions.slice(1, -1)
  const count = middle.length
  const mu = (count - 1) / 2
  const sigma = count / 6
  const scored = middle.map((interaction, index) => {
    const boundary = 1 - Math.exp(-((index - mu) ** 2) / (2 * sigma ** 2))
    const novelty = index < count - 1 ? 1 - hiAgentSimilarity(observation(interaction), observation(middle[index + 1]!)) : 0
    return { id: interaction.id, score: boundary + novelty }
  })
  const selectedMiddle = scored.sort((left, right) => left.score - right.score || left.id - right.id)
    .slice(-(memorySize - 2)).map(item => item.id)
  return new Set([interactions[0]!.id, ...selectedMiddle, interactions.at(-1)!.id])
}

function interactionText(interaction: ToolEpisode): string {
  const actions = interaction.actions.map(action => `Action: ${action.tool} ${action.arguments}\nObservation${action.isError ? ' (error)' : ''}: ${action.result}`).join('\n')
  return `${interaction.explanation ? `Reasoning: ${interaction.explanation}\n` : ''}${actions}`
}

/** Render selected interactions and explicit placeholders in trajectory order. */
export function renderHiAgentWorkspace(state: HiAgentState, memorySize: number): string {
  const selected = selectHiAgentInteractions(state.interactions, memorySize)
  const history = state.interactions.map(interaction => selected.has(interaction.id)
    ? `[${interaction.id}] ${interactionText(interaction)}`
    : `[${interaction.id}] Omitted: Action-Observation pair`).join('\n\n') || 'EMPTY'
  return `### Goal\n${state.originalTask ?? '(unavailable)'}\n\n### Working Memory\n${history}`
}

/** Fixed-size HiAgent working-memory policy. */
export interface HiAgentConfig {
  readonly memorySize: number
}

/** Install official-code value-sampled working memory on the native DSH loop. */
export function applyHiAgent(ctx: Context, config: HiAgentConfig): void {
  if (!Number.isSafeInteger(config.memorySize) || config.memorySize < 2) throw new Error('hiagent memorySize must be a safe integer of at least 2')
  ctx.sessionProjections.register(hiAgentProjectionDefinition)
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const state = ctx.sessionProjections.stateOf(agent.session, HIAGENT_PROJECTION_KEY)
    if (state === undefined || state.interactions.length === 0 || state.interactions.length <= state.surfacedInteractions) return await next()
    const nodes = agent.session.surface.nodes
    const first = nodes[0]
    const start = first === undefined || agent.session.eventAt(first)?.type !== 'system/message' ? first : nodes[1]
    const end = nodes.at(-1)
    if (start !== undefined && end !== undefined) {
      agent.session.append('user/message', createUserMessage({
        source: { kind: 'plugin', plugin: HIAGENT_SOURCE }, content: [{ type: 'text', text: renderHiAgentWorkspace(state, config.memorySize) }],
      }), { surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: nodes.slice(nodes.indexOf(start)) })
    }
    return await next()
  })
  registerHarnessPrompt(ctx, {
    id: 'hiagent',
    text: 'Operate as a direct ReAct agent without an explicit plan. HiAgent retains the complete trajectory in the Session but samples the model-facing working memory by boundary importance and observation novelty. Earlier entries marked Omitted were executed but are hidden due to the memory budget. Use the retained evidence, do not repeat actions solely because an entry is omitted, and provide the final answer only when the task is resolved.',
  })
}
