import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { auxiliaryText } from '../runtime/auxiliary-llm.js'
import { contentText } from '../runtime/content.js'
import { registerHarnessContext, registerHarnessPrompt } from '../runtime/prompt.js'
import { foldToolEpisodes, initialToolEpisodeCollection } from '../runtime/tool-episodes.js'
import type { ToolEpisode, ToolEpisodeCollection } from '../runtime/tool-episodes.js'

const FOLD_TOOL = 'deepagent_fold_thoughts'
const SEARCH_TOOL = 'deepagent_tool_search'
const DEEPAGENT_SOURCE = 'harness-all-in-dsh:deepagent'
const DEEPAGENT_PROMPT = `Operate as DeepAgent in one continuous reasoning-and-action stream without an up-front plan. Call exactly one tool per step. Use ${SEARCH_TOOL} when the current catalogue is too large or you need to discover a capability. When history is long, repeated failures suggest a stale strategy, or a fresh perspective would help, call ${FOLD_TOOL}; it will create episodic, working, and tool memories and reset the active trajectory. Do not repeat an identical tool call. Answer only when the task is resolved.`

/** Host projection key for DeepAgent's three-memory folding state. */
export const DEEPAGENT_PROJECTION_KEY = 'harness-all-in-dsh/deepagent' as const

/** One completed three-tier thought fold. */
export interface DeepAgentFold {
  readonly number: number
  readonly foldedThrough: number
  readonly episodic: string
  readonly working: string
  readonly tool: string
  readonly provider: string
  readonly model: string
  readonly sourceInteractionIds: readonly number[]
}

interface PendingFold { readonly callId: string }

/** Session-derived DeepAgent trajectory, searches, and latest memory fold. */
export interface DeepAgentState extends ToolEpisodeCollection {
  readonly originalTask: string | null
  readonly folds: readonly DeepAgentFold[]
  readonly pendingFold: PendingFold | null
  readonly pendingSearches: Readonly<Record<string, string>>
  readonly searches: readonly string[]
  readonly surfacedFolds: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** DeepAgent complete trajectory and structured folded memories. */
    [DEEPAGENT_PROJECTION_KEY]: DeepAgentState
  }
}

const actionSchema = z.object({ tool: z.string(), arguments: z.string(), result: z.string(), isError: z.boolean() })
const interactionSchema = z.object({
  id: z.number().int().nonnegative(), agentStep: z.number().int().nonnegative(), explanation: z.string(),
  actions: z.array(actionSchema), relatedSeqs: z.array(z.number().int().nonnegative()),
})
const foldSchema = z.object({
  number: z.number().int().positive(), foldedThrough: z.number().int(), episodic: z.string(), working: z.string(), tool: z.string(),
  provider: z.string(), model: z.string(), sourceInteractionIds: z.array(z.number().int().nonnegative()),
})
const stateSchema: z.ZodType<DeepAgentState> = z.object({
  originalTask: z.string().nullable(), interactions: z.array(interactionSchema),
  assistants: z.record(z.string(), z.object({ text: z.string(), seq: z.number().int().nonnegative() })),
  calls: z.record(z.string(), z.object({ step: z.number().int().nonnegative(), tool: z.string(), arguments: z.string(), seq: z.number().int().nonnegative() })),
  results: z.record(z.string(), z.object({ result: z.string(), isError: z.boolean(), seq: z.number().int().nonnegative() })),
  folds: z.array(foldSchema), pendingFold: z.object({ callId: z.string() }).nullable(),
  pendingSearches: z.record(z.string(), z.string()), searches: z.array(z.string()), surfacedFolds: z.number().int().nonnegative(),
})

/** Create the empty DeepAgent state. */
export function initialDeepAgentState(): DeepAgentState {
  return {
    originalTask: null, folds: [], pendingFold: null, pendingSearches: {}, searches: [], surfacedFolds: 0,
    ...initialToolEpisodeCollection(),
  }
}

function parsedObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function callId(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return String(event.data.message.content[0].toolCallId)
}

/** Pure Session-event fold for DeepAgent memory operations and interactions. */
export function foldDeepAgentState(state: DeepAgentState, event: SessionEvent): DeepAgentState {
  if (event.type === 'user/message') {
    if (event.data.source.kind === 'user' && state.originalTask === null) return { ...state, originalTask: contentText(event.data.content) }
    if (event.data.source.kind === 'plugin' && event.data.source.plugin === DEEPAGENT_SOURCE) return { ...state, surfacedFolds: state.folds.length }
    return state
  }
  if (event.type === 'tool/call') {
    const id = String(event.data.callId)
    if (event.data.name === FOLD_TOOL) return { ...state, pendingFold: { callId: id } }
    if (event.data.name === SEARCH_TOOL) {
      const args = parsedObject(event.data.arguments)
      const query = typeof args?.query === 'string' ? args.query.trim().toLocaleLowerCase() : ''
      return foldToolEpisodes({ ...state, pendingSearches: { ...state.pendingSearches, [id]: query } }, event)
    }
  }
  if (event.type === 'tool/result') {
    const id = callId(event)
    if (state.pendingFold?.callId === id) {
      if (event.data.message.content[0].isError) return { ...state, pendingFold: null }
      const value = parsedObject(contentText(event.data.message.content[0].content))
      const parsed = foldSchema.safeParse(value)
      return parsed.success ? { ...state, folds: [...state.folds, parsed.data], pendingFold: null } : { ...state, pendingFold: null }
    }
    const query = state.pendingSearches[id]
    if (query !== undefined) {
      const pendingSearches = { ...state.pendingSearches }
      delete pendingSearches[id]
      const searched = event.data.message.content[0].isError || query.length === 0 || state.searches.includes(query)
        ? state.searches : [...state.searches, query]
      return foldToolEpisodes({ ...state, pendingSearches, searches: searched }, event)
    }
  }
  return foldToolEpisodes(state, event, new Set([FOLD_TOOL]))
}

/** Durable DeepAgent memory projection. */
export const deepAgentProjectionDefinition = {
  key: DEEPAGENT_PROJECTION_KEY, stateSchema, init: initialDeepAgentState, apply: foldDeepAgentState, stateVersion: 1,
} satisfies ProjectionDefinition<typeof DEEPAGENT_PROJECTION_KEY, DeepAgentState>

function requireAgent(exec: ToolExecution, tool: string): Agent {
  if (exec.agent === undefined) throw new Error(`${tool} requires an owning DSH Agent`)
  return exec.agent
}

function interactionText(interaction: ToolEpisode): string {
  return `Step ${interaction.id}:\n${interaction.explanation ? `Reasoning: ${interaction.explanation}\n` : ''}${interaction.actions.map(action => `Tool: ${action.tool} ${action.arguments}\nResult${action.isError ? ' (error)' : ''}: ${action.result.slice(0, 2_000)}`).join('\n')}`
}

function foldPrompts(state: DeepAgentState): { episodic: string; working: string; tool: string; ids: readonly number[] } {
  const previous = state.folds.at(-1)?.foldedThrough ?? -1
  const current = state.interactions.filter(interaction => interaction.id > previous)
  if (current.length === 0) throw new Error('DeepAgent requires new interactions before folding')
  const reasoning = current.map(interactionText).join('\n\n')
  const allTools = state.interactions.flatMap(interaction => interaction.actions.map(action => ({
    tool: action.tool, arguments: action.arguments, result: action.result.slice(0, 1_000), error: action.isError,
  })))
  const task = state.originalTask ?? '(unavailable)'
  return {
    ids: current.map(interaction => interaction.id),
    episodic: `Task:\n${task}\n\nRecent reasoning and interactions:\n${reasoning}\n\nThe thought-fold operation invoking this summary is completing now. Return strict JSON with task_description, key_events (step, description, outcome), and current_progress. Preserve major milestones, decisions, outcomes, and unfinished work, and describe the fold as completed rather than pending. Use short strings, include at most 8 key events, and keep the complete response below 600 tokens. Output JSON only.`,
    working: `Task:\n${task}\n\nRecent reasoning and interactions:\n${reasoning}\n\nThe thought-fold operation invoking this summary is completing now. Return strict JSON with immediate_goal, current_challenges, and next_actions (type, description). Do not list another fold as the next action unless the task independently requires a later fold. Include only the state after this fold and near-term actions, not completed history. Use short strings, include at most 5 challenges and 5 actions, and keep the complete response below 500 tokens. Output JSON only.`,
    tool: `Task:\n${task}\n\nRecent reasoning and interactions:\n${reasoning}\n\nComplete tool history:\n${JSON.stringify(allTools)}\n\nReturn strict JSON with tools_used (tool_name, success_rate, effective_parameters, common_errors, response_pattern, experience) and derived_rules. Merge repeated calls by tool, use short strings, and keep the complete response below 700 tokens. Output JSON only.`,
  }
}

const EPISODIC_SYSTEM = 'You compress an agent trajectory into accurate episodic memory. Do not invent events or outcomes.'
const WORKING_SYSTEM = 'You maintain the immediate working state of a tool-using agent. Do not invent progress.'
const TOOL_SYSTEM = 'You extract reusable tool-use experience from logged calls and results. Do not invent tool behavior.'

function foldTool(ctx: Context, config: DeepAgentConfig): ToolDefinition {
  return {
    name: FOLD_TOOL,
    description: 'Fold the current DeepAgent trajectory into episodic, working, and tool memories, then restart reasoning from those memories.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => value,
    },
    async execute(_args, exec) {
      const agent = requireAgent(exec, FOLD_TOOL)
      const state = ctx.sessionProjections.stateOf(agent.session, DEEPAGENT_PROJECTION_KEY)
      if (state === undefined) throw new Error('DeepAgent projection is unavailable')
      if (state.folds.length >= config.maxFolds) throw new Error(`DeepAgent allows at most ${config.maxFolds} thought folds`)
      const prompts = foldPrompts(state)
      const [episodic, working, tool] = await Promise.all([
        auxiliaryText(ctx, agent, EPISODIC_SYSTEM, prompts.episodic, config.auxiliaryMaxTokens, exec.signal),
        auxiliaryText(ctx, agent, WORKING_SYSTEM, prompts.working, config.auxiliaryMaxTokens, exec.signal),
        auxiliaryText(ctx, agent, TOOL_SYSTEM, prompts.tool, config.auxiliaryMaxTokens, exec.signal),
      ])
      return {
        number: state.folds.length + 1, foldedThrough: prompts.ids.at(-1) ?? -1,
        episodic: episodic.text, working: working.text, tool: tool.text,
        provider: episodic.provider, model: episodic.model, sourceInteractionIds: prompts.ids,
      }
    },
  }
}

interface SearchableTool { readonly name: string; readonly description?: string; readonly parameters?: unknown }

function scoreTool(tool: SearchableTool, terms: readonly string[]): number {
  const text = `${tool.name} ${tool.description ?? ''} ${JSON.stringify(tool.parameters ?? {})}`.toLocaleLowerCase()
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0)
}

function searchTool(ctx: Context): ToolDefinition {
  return {
    name: SEARCH_TOOL,
    description: 'Search the current DSH tool catalogue by capability keywords and return matching schemas.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', minLength: 4 }, topK: { type: 'integer', minimum: 1, maximum: 20 },
    }, required: ['query', 'topK'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const agent = requireAgent(exec, SEARCH_TOOL)
      const state = ctx.sessionProjections.stateOf(agent.session, DEEPAGENT_PROJECTION_KEY)
      if (state === undefined) throw new Error('DeepAgent projection is unavailable')
      const input = args as { query?: unknown; topK?: unknown }
      if (typeof input.query !== 'string' || input.query.trim().length < 4 || !Number.isSafeInteger(input.topK)) throw new Error('deepagent_tool_search requires query and topK')
      const query = input.query.trim().toLocaleLowerCase()
      if (state.searches.includes(query)) throw new Error('DeepAgent has already searched this exact query')
      const terms = query.match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
      const tools = (agent.session.requestHeader()?.tools ?? []) as readonly SearchableTool[]
      const matches = tools.filter(tool => tool.name !== FOLD_TOOL && tool.name !== SEARCH_TOOL)
        .map(tool => ({ tool, score: scoreTool(tool, terms) })).filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
        .slice(0, input.topK as number).map(item => item.tool)
      return { query, tools: matches.length > 0 ? matches : tools.filter(tool => tool.name !== FOLD_TOOL && tool.name !== SEARCH_TOOL).slice(0, input.topK as number) }
    },
  }
}

/** Render the post-fold reset surface. */
export function renderDeepAgentCheckpoint(state: DeepAgentState): string {
  const fold = state.folds.at(-1)
  if (fold === undefined) return `Task:\n${state.originalTask ?? '(unavailable)'}`
  const recent = state.interactions.filter(interaction => interaction.id > fold.foldedThrough).map(interactionText).join('\n\n') || '(none)'
  return `Task:\n${state.originalTask ?? '(unavailable)'}\n\nFold checkpoint #${fold.number} is complete. Continue after the fold; do not call the fold tool merely because pre-fold memory mentions it.\n\nMemory of previous folded thoughts:\n\nEpisode Memory:\n${fold.episodic}\n\nWorking Memory:\n${fold.working}\n\nTool Memory:\n${fold.tool}\n\nInteractions after the fold:\n${recent}`
}

/** Render the remaining model-directed fold budget. */
export function renderDeepAgentContext(state: DeepAgentState, maxFolds: number): string {
  return `DeepAgent state: ${maxFolds - state.folds.length} fold(s) remain.`
}

/** DeepAgent folding and auxiliary-call limits. */
export interface DeepAgentConfig {
  readonly maxFolds: number
  readonly auxiliaryMaxTokens: number
}

/** Install tool discovery and autonomous three-tier thought folding. */
export function applyDeepAgent(ctx: Context, config: DeepAgentConfig): void {
  if (!Number.isSafeInteger(config.maxFolds) || config.maxFolds < 1) throw new Error('deepagent maxFolds must be a positive safe integer')
  if (!Number.isSafeInteger(config.auxiliaryMaxTokens) || config.auxiliaryMaxTokens < 1) throw new Error('deepagent auxiliaryMaxTokens must be a positive safe integer')
  ctx.sessionProjections.register(deepAgentProjectionDefinition)
  ctx.tools.register(foldTool(ctx, config))
  ctx.tools.register(searchTool(ctx))
  ctx.tools.guard(exec => {
    if (exec.agent === undefined || exec.name === FOLD_TOOL || exec.name === SEARCH_TOOL) return undefined
    const state = ctx.sessionProjections.stateOf(exec.agent.session, DEEPAGENT_PROJECTION_KEY)
    const key = `${exec.name}:${JSON.stringify(exec.arguments)}`
    const duplicate = state?.interactions.some(interaction => interaction.actions.some(action => `${action.tool}:${action.arguments}` === key))
    return duplicate ? 'DeepAgent already called this tool with identical arguments; choose a different action.' : undefined
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const state = ctx.sessionProjections.stateOf(agent.session, DEEPAGENT_PROJECTION_KEY)
    if (state === undefined || state.folds.length === 0 || state.folds.length <= state.surfacedFolds) return await next()
    const nodes = agent.session.surface.nodes
    const first = nodes[0]
    const start = first === undefined || agent.session.eventAt(first)?.type !== 'system/message' ? first : nodes[1]
    const end = nodes.at(-1)
    if (start !== undefined && end !== undefined) {
      agent.session.append('user/message', createUserMessage({
        source: { kind: 'plugin', plugin: DEEPAGENT_SOURCE }, content: [{ type: 'text', text: renderDeepAgentCheckpoint(state) }],
      }), { surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: nodes.slice(nodes.indexOf(start)) })
    }
    return await next()
  })
  registerHarnessPrompt(ctx, { id: 'deepagent', text: DEEPAGENT_PROMPT })
  registerHarnessContext(ctx, {
    id: 'deepagent',
    text: ({ agent }) => {
      if (agent === undefined) return ''
      const state = ctx.sessionProjections.stateOf(agent.session, DEEPAGENT_PROJECTION_KEY)
      if (state === undefined) throw new Error('DeepAgent projection is unavailable')
      return renderDeepAgentContext(state, config.maxFolds)
    },
  })
}
