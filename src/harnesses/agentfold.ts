import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { contentText } from '../runtime/content.js'
import { registerHarnessContext, registerHarnessPrompt } from '../runtime/prompt.js'
import { foldToolEpisodes, initialToolEpisodeCollection } from '../runtime/tool-episodes.js'
import type { ToolEpisode } from '../runtime/tool-episodes.js'

const FOLD_TOOL = 'agentfold_fold'
const AGENTFOLD_SOURCE = 'harness-all-in-dsh:agentfold'

/** Host projection key for AgentFold's replayable multi-scale workspace. */
export const AGENTFOLD_PROJECTION_KEY = 'harness-all-in-dsh/agentfold' as const

/** One complete external action and observation retained at full fidelity. */
export type AgentFoldInteraction = ToolEpisode

/** One model-written summary over a contiguous partition of interactions. */
export interface AgentFoldSummary {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly relatedSeqs: readonly number[]
}

interface PendingFold {
  readonly start: number
  readonly end: number
  readonly summary: string
}

/** Session-derived AgentFold interactions, summaries, and surface progress. */
export interface AgentFoldState {
  readonly originalTask: string | null
  readonly interactions: readonly AgentFoldInteraction[]
  readonly summaries: readonly AgentFoldSummary[]
  readonly assistants: Readonly<Record<string, { readonly text: string; readonly seq: number }>>
  readonly calls: Readonly<Record<string, { readonly step: number; readonly tool: string; readonly arguments: string; readonly seq: number }>>
  readonly results: Readonly<Record<string, { readonly result: string; readonly isError: boolean; readonly seq: number }>>
  readonly pendingFolds: Readonly<Record<string, PendingFold>>
  readonly foldCount: number
  readonly surfacedInteractions: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** AgentFold multi-scale summaries and latest full interaction. */
    [AGENTFOLD_PROJECTION_KEY]: AgentFoldState
  }
}

const actionSchema = z.object({ tool: z.string(), arguments: z.string(), result: z.string(), isError: z.boolean() })
const interactionSchema = z.object({
  id: z.number().int().nonnegative(), agentStep: z.number().int().nonnegative(), explanation: z.string(),
  actions: z.array(actionSchema), relatedSeqs: z.array(z.number().int().nonnegative()),
})
const summarySchema = z.object({
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), text: z.string(),
  relatedSeqs: z.array(z.number().int().nonnegative()),
})
const callSchema = z.object({ step: z.number().int().nonnegative(), tool: z.string(), arguments: z.string(), seq: z.number().int().nonnegative() })
const resultSchema = z.object({ result: z.string(), isError: z.boolean(), seq: z.number().int().nonnegative() })
const pendingFoldSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), summary: z.string() })
const stateSchema: z.ZodType<AgentFoldState> = z.object({
  originalTask: z.string().nullable(), interactions: z.array(interactionSchema), summaries: z.array(summarySchema),
  assistants: z.record(z.string(), z.object({ text: z.string(), seq: z.number().int().nonnegative() })),
  calls: z.record(z.string(), callSchema), results: z.record(z.string(), resultSchema),
  pendingFolds: z.record(z.string(), pendingFoldSchema), foldCount: z.number().int().nonnegative(),
  surfacedInteractions: z.number().int().nonnegative(),
})

/** Create the empty AgentFold workspace. */
export function initialAgentFoldState(): AgentFoldState {
  return {
    originalTask: null, summaries: [], ...initialToolEpisodeCollection(),
    pendingFolds: {}, foldCount: 0, surfacedInteractions: 0,
  }
}

function parsedObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function foldInput(raw: string): PendingFold | undefined {
  const value = parsedObject(raw)
  if (value === undefined || !Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end)
    || typeof value.summary !== 'string' || value.summary.trim().length === 0) return undefined
  return { start: value.start as number, end: value.end as number, summary: value.summary.trim() }
}

function toolResultId(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return String(event.data.message.content[0].toolCallId)
}

function assertPartition(state: AgentFoldState, input: PendingFold): void {
  const latest = state.interactions.at(-1)?.id
  if (latest === undefined) throw new Error('agentfold_fold requires a completed interaction')
  if (input.end !== latest) throw new Error(`agentfold_fold range must end at the latest interaction ${latest}`)
  if (input.start < 0 || input.start > input.end) throw new Error('agentfold_fold requires a valid ascending range')
  const retained = state.summaries.filter(block => block.end < input.start)
  let expected = 0
  for (const block of retained) {
    if (block.start !== expected) throw new Error('AgentFold summary partition is not contiguous')
    expected = block.end + 1
  }
  if (expected !== input.start) throw new Error(`agentfold_fold range must begin at an active summary boundary (${expected})`)
}

/** Apply one validated granular condensation or deep consolidation. */
export function applyAgentFoldSummary(state: AgentFoldState, input: PendingFold): readonly AgentFoldSummary[] {
  assertPartition(state, input)
  const retained = state.summaries.filter(block => block.end < input.start)
  const relatedSeqs = [...new Set(state.interactions
    .filter(interaction => interaction.id >= input.start && interaction.id <= input.end)
    .flatMap(interaction => interaction.relatedSeqs))].sort((left, right) => left - right)
  return [...retained, { start: input.start, end: input.end, text: input.summary, relatedSeqs }]
}

/** Pure Session-event fold for AgentFold's two-level cognitive workspace. */
export function foldAgentFoldState(state: AgentFoldState, event: SessionEvent): AgentFoldState {
  if (event.type === 'user/message') {
    if (event.data.source.kind === 'user' && state.originalTask === null) return { ...state, originalTask: contentText(event.data.content) }
    if (event.data.source.kind === 'plugin' && event.data.source.plugin === AGENTFOLD_SOURCE) {
      return { ...state, surfacedInteractions: state.interactions.length }
    }
    return state
  }
  if (event.type === 'tool/call') {
    const callId = String(event.data.callId)
    if (event.data.name === FOLD_TOOL) {
      const input = foldInput(event.data.arguments)
      return input === undefined ? state : { ...state, pendingFolds: { ...state.pendingFolds, [callId]: input } }
    }
  }
  if (event.type === 'tool/result') {
    const callId = toolResultId(event)
    const pendingFold = state.pendingFolds[callId]
    if (pendingFold !== undefined) {
      const pendingFolds = { ...state.pendingFolds }
      delete pendingFolds[callId]
      if (event.data.message.content[0].isError) return { ...state, pendingFolds }
      try {
        return { ...state, summaries: applyAgentFoldSummary(state, pendingFold), pendingFolds, foldCount: state.foldCount + 1 }
      } catch {
        return { ...state, pendingFolds }
      }
    }
  }
  return foldToolEpisodes(state, event, new Set([FOLD_TOOL]))
}

/** Durable AgentFold workspace projection. */
export const agentFoldProjectionDefinition = {
  key: AGENTFOLD_PROJECTION_KEY, stateSchema, init: initialAgentFoldState, apply: foldAgentFoldState, stateVersion: 1,
} satisfies ProjectionDefinition<typeof AGENTFOLD_PROJECTION_KEY, AgentFoldState>

function requireAgent(exec: ToolExecution): Agent {
  if (exec.agent === undefined) throw new Error(`${FOLD_TOOL} requires an owning DSH Agent`)
  return exec.agent
}

function foldTool(ctx: Context): ToolDefinition {
  return {
    name: FOLD_TOOL,
    description: 'Fold a contiguous suffix ending at the latest completed AgentFold interaction into one model-written state summary. Call it alongside the next task tool.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, summary: { type: 'string', minLength: 1 },
    }, required: ['start', 'end', 'summary'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const state = ctx.sessionProjections.stateOf(agent.session, AGENTFOLD_PROJECTION_KEY)
      if (state === undefined) throw new Error('AgentFold projection is unavailable')
      const input = foldInput(JSON.stringify(args))
      if (input === undefined) throw new Error('agentfold_fold requires start, end, and a non-empty summary')
      applyAgentFoldSummary(state, input)
      return { folded: [input.start, input.end], summary: input.summary }
    },
  }
}

function interactionText(interaction: AgentFoldInteraction): string {
  const actions = interaction.actions.map(action => `Tool call: ${action.tool} ${action.arguments}\nTool response${action.isError ? ' (error)' : ''}: ${action.result}`).join('\n')
  return `${interaction.explanation ? `Explanation: ${interaction.explanation}\n` : ''}${actions}`
}

/** Render the exact multi-scale-summary plus latest-interaction workspace. */
export function renderAgentFoldWorkspace(state: AgentFoldState): string {
  const summaries = state.summaries.map(block => `**[Compressed Step ${block.start}${block.end === block.start ? '' : ` to ${block.end}`}]**\n${block.text}`).join('\n\n') || 'EMPTY'
  const latest = state.interactions.at(-1)
  return `### Question\n${state.originalTask ?? '(unavailable)'}\n\n### Multi-Scale State Summaries\n${summaries}\n\n### Latest Interaction\n${latest === undefined ? 'EMPTY' : `**[Step ${latest.id}]**\n${interactionText(latest)}`}`
}

const AGENTFOLD_PROMPT = `Operate as AgentFold's perceive-reason-fold-act loop. Your working context contains the invariant question, multi-scale summaries of older interactions, and one latest interaction at full fidelity. Do not make an up-front DAG plan and do not uniformly resummarize all history. Follow the current AgentFold state directive when choosing a fold and external action. If the task is complete, answer directly without another tool call. Never invent step ids or evidence.`

/** Render the fold requirement for the latest replayed interaction. */
export function renderAgentFoldContext(state: AgentFoldState): string {
  const latest = state.interactions.at(-1)
  return latest === undefined
    ? `AgentFold state: there is no previous interaction. Do not call ${FOLD_TOOL}; call exactly one task tool if external action is needed.`
    : `AgentFold state: the latest full interaction is Step ${latest.id}. If another external action is needed, emit exactly two tool calls in this response: (1) ${FOLD_TOOL}, whose range must end at ${latest.id}, and (2) exactly one task tool. Use start=${latest.id} for granular condensation, or start at an existing summary boundary for deep consolidation. The fold summary must preserve facts, sources, constraints, and unresolved leads needed later.`
}

/** Install proactive model-directed folding on the native DSH Agent loop. */
export function applyAgentFold(ctx: Context): void {
  ctx.sessionProjections.register(agentFoldProjectionDefinition)
  ctx.tools.register(foldTool(ctx))
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const state = ctx.sessionProjections.stateOf(agent.session, AGENTFOLD_PROJECTION_KEY)
    if (state === undefined || state.interactions.length === 0 || state.interactions.length <= state.surfacedInteractions) return await next()
    const nodes = agent.session.surface.nodes
    const first = nodes[0]
    const start = first === undefined || agent.session.eventAt(first)?.type !== 'system/message' ? first : nodes[1]
    const end = nodes.at(-1)
    if (start !== undefined && end !== undefined) {
      agent.session.append('user/message', createUserMessage({
        source: { kind: 'plugin', plugin: AGENTFOLD_SOURCE }, content: [{ type: 'text', text: renderAgentFoldWorkspace(state) }],
      }), { surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: nodes.slice(nodes.indexOf(start)) })
    }
    return await next()
  })
  registerHarnessPrompt(ctx, { id: 'agentfold', text: AGENTFOLD_PROMPT })
  registerHarnessContext(ctx, {
    id: 'agentfold',
    text: ({ agent }) => {
      if (agent === undefined) return ''
      const state = ctx.sessionProjections.stateOf(agent.session, AGENTFOLD_PROJECTION_KEY)
      if (state === undefined) throw new Error('AgentFold projection is unavailable')
      return renderAgentFoldContext(state)
    },
  })
}
