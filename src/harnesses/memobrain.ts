import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-token-meter'
import { z } from 'zod'
import { auxiliaryText } from '../runtime/auxiliary-llm.js'
import { contentText } from '../runtime/content.js'
import { registerHarnessPrompt } from '../runtime/prompt.js'

const MEMOBRAIN_SOURCE = 'harness-all-in-dsh:memobrain'
const MEMORY_SYSTEM = `You maintain a dependency-aware reasoning graph for a tool-using agent. Given the current graph and one completed tool episode, output strict JSON with addNodes and addEdges. Each new node has tempId, kind (subtask or evidence), and notes (role/content pairs). Each edge has src, dst, and rationale; endpoints may be existing numeric ids or new tempIds. Add only meaningful steps, connect them without cycles, and output JSON only.`
const RECALL_SYSTEM = `You optimize a dependency-aware reasoning graph. Output strict JSON with flush and folds. flush is a list of {id,rationale} for active redundant, invalid, or superseded nodes. folds is a list of {ids,rationale,notes} for active completed paths; notes is a compact role/content message list that preserves conclusions and evidence. Never include the task node, never target a node twice, and output JSON only.`

/** Host projection key for MemoBrain's replayable reasoning graph. */
export const MEMOBRAIN_PROJECTION_KEY = 'harness-all-in-dsh/memobrain' as const

/** One concise message retained in a reasoning node. */
export interface MemoNote {
  readonly role: string
  readonly content: string
}

/** One task, subtask, evidence, or folded-summary node. */
export interface MemoNode {
  readonly id: number
  readonly kind: 'task' | 'subtask' | 'evidence' | 'summary'
  readonly notes: readonly MemoNote[]
  readonly relatedSeqs: readonly number[]
  readonly status: 'active' | 'flushed' | 'folded'
}

/** One directed dependency in the reasoning graph. */
export interface MemoEdge {
  readonly src: number
  readonly dst: number
  readonly rationale: string
}

/** A completed tool episode waiting for passive graph insertion. */
export interface MemoEpisode {
  readonly id: string
  readonly step: number
  readonly assistant: string
  readonly tool: string
  readonly arguments: string
  readonly result: string
  readonly isError: boolean
  readonly relatedSeqs: readonly number[]
}

/** Session-derived MemoBrain graph and automatic-maintenance progress. */
export interface MemoBrainState {
  readonly originalTask: string | null
  readonly nodes: readonly MemoNode[]
  readonly edges: readonly MemoEdge[]
  readonly pendingCalls: Readonly<Record<string, { readonly step: number; readonly tool: string; readonly arguments: string; readonly seq: number }>>
  readonly assistants: Readonly<Record<string, { readonly text: string; readonly seq: number }>>
  readonly pendingEpisodes: readonly MemoEpisode[]
  readonly processedEpisodes: number
  readonly recalledEpisodes: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** MemoBrain task graph and passive memory-maintenance state. */
    [MEMOBRAIN_PROJECTION_KEY]: MemoBrainState
  }
}

const noteSchema = z.object({ role: z.string(), content: z.string() })
const nodeSchema = z.object({
  id: z.number().int().positive(), kind: z.enum(['task', 'subtask', 'evidence', 'summary']),
  notes: z.array(noteSchema), relatedSeqs: z.array(z.number().int().nonnegative()), status: z.enum(['active', 'flushed', 'folded']),
})
const edgeSchema = z.object({ src: z.number().int().positive(), dst: z.number().int().positive(), rationale: z.string() })
const episodeSchema = z.object({
  id: z.string(), step: z.number().int().nonnegative(), assistant: z.string(), tool: z.string(), arguments: z.string(),
  result: z.string(), isError: z.boolean(), relatedSeqs: z.array(z.number().int().nonnegative()),
})
const stateSchema: z.ZodType<MemoBrainState> = z.object({
  originalTask: z.string().nullable(), nodes: z.array(nodeSchema), edges: z.array(edgeSchema),
  pendingCalls: z.record(z.string(), z.object({ step: z.number().int().nonnegative(), tool: z.string(), arguments: z.string(), seq: z.number().int().nonnegative() })),
  assistants: z.record(z.string(), z.object({ text: z.string(), seq: z.number().int().nonnegative() })),
  pendingEpisodes: z.array(episodeSchema), processedEpisodes: z.number().int().nonnegative(), recalledEpisodes: z.number().int().nonnegative(),
})

const graphPatchSchema = z.object({
  addNodes: z.array(z.object({
    tempId: z.string().min(1), kind: z.enum(['subtask', 'evidence']), notes: z.array(noteSchema).min(1),
  })),
  addEdges: z.array(z.object({
    src: z.union([z.number().int().positive(), z.string().min(1)]),
    dst: z.union([z.number().int().positive(), z.string().min(1)]), rationale: z.string(),
  })),
})
const recallPatchSchema = z.object({
  flush: z.array(z.object({ id: z.number().int().positive(), rationale: z.string() })),
  folds: z.array(z.object({ ids: z.array(z.number().int().positive()).min(1), rationale: z.string(), notes: z.array(noteSchema).min(1) })),
})
/** Model-written additions for one completed tool episode. */
export type MemoGraphPatch = z.infer<typeof graphPatchSchema>
/** Model-written flush and fold decisions for one recall. */
export type MemoRecallPatch = z.infer<typeof recallPatchSchema>

interface StoredEvent {
  readonly kind: 'memory' | 'recall'
  readonly episodeId?: string
  readonly patch: MemoGraphPatch | MemoRecallPatch | null
  readonly rawOutput: string
  readonly provider: string
  readonly model: string
  readonly error?: string
}

/** Create the empty MemoBrain state. */
export function initialMemoBrainState(): MemoBrainState {
  return {
    originalTask: null, nodes: [], edges: [], pendingCalls: {}, assistants: {}, pendingEpisodes: [],
    processedEpisodes: 0, recalledEpisodes: 0,
  }
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
  return JSON.parse(trimmed)
}

function assertAcyclic(nodes: readonly MemoNode[], edges: readonly MemoEdge[]): void {
  const children = new Map<number, number[]>()
  for (const node of nodes) children.set(node.id, [])
  for (const edge of edges) {
    if (!children.has(edge.src) || !children.has(edge.dst)) throw new Error(`unknown MemoBrain edge endpoint ${edge.src} -> ${edge.dst}`)
    children.get(edge.src)?.push(edge.dst)
  }
  const visiting = new Set<number>()
  const visited = new Set<number>()
  const walk = (id: number): void => {
    if (visiting.has(id)) throw new Error('MemoBrain patch creates a cycle')
    if (visited.has(id)) return
    visiting.add(id)
    for (const child of children.get(id) ?? []) walk(child)
    visiting.delete(id)
    visited.add(id)
  }
  for (const node of nodes) walk(node.id)
}

/** Apply one validated model patch to the reasoning graph. */
export function applyMemoGraphPatch(
  state: MemoBrainState,
  patch: MemoGraphPatch,
  relatedSeqs: readonly number[],
): Pick<MemoBrainState, 'nodes' | 'edges'> {
  const tempIds = new Map<string, number>()
  let nextId = state.nodes.reduce((maximum, node) => Math.max(maximum, node.id), 0) + 1
  const additions: MemoNode[] = []
  for (const input of patch.addNodes) {
    if (tempIds.has(input.tempId)) throw new Error(`duplicate MemoBrain tempId ${input.tempId}`)
    tempIds.set(input.tempId, nextId)
    additions.push({ id: nextId, kind: input.kind, notes: input.notes, relatedSeqs: [...relatedSeqs], status: 'active' })
    nextId += 1
  }
  const known = new Set([...state.nodes.map(node => node.id), ...additions.map(node => node.id)])
  const resolve = (value: number | string): number => {
    const id = typeof value === 'number' ? value : tempIds.get(value)
    if (id === undefined || !known.has(id)) throw new Error(`unknown MemoBrain node reference ${String(value)}`)
    return id
  }
  const edges = [...state.edges, ...patch.addEdges.map(edge => ({ src: resolve(edge.src), dst: resolve(edge.dst), rationale: edge.rationale }))]
  const nodes = [...state.nodes, ...additions]
  assertAcyclic(nodes, edges)
  return { nodes, edges }
}

/** Apply model-selected flush and fold operations with official edge rewiring. */
export function applyMemoRecall(state: MemoBrainState, patch: MemoRecallPatch): Pick<MemoBrainState, 'nodes' | 'edges'> {
  const active = new Map(state.nodes.filter(node => node.status === 'active').map(node => [node.id, node]))
  const targeted = new Set<number>()
  for (const operation of [...patch.flush, ...patch.folds.flatMap(fold => fold.ids.map(id => ({ id })))]) {
    const node = active.get(operation.id)
    if (node === undefined || node.kind === 'task' || targeted.has(operation.id)) throw new Error(`invalid MemoBrain recall target ${operation.id}`)
    targeted.add(operation.id)
  }
  let nodes = state.nodes.map(node => patch.flush.some(operation => operation.id === node.id) ? { ...node, status: 'flushed' as const } : node)
  let edges = [...state.edges]
  let nextId = nodes.reduce((maximum, node) => Math.max(maximum, node.id), 0) + 1
  for (const fold of patch.folds) {
    const ids = new Set(fold.ids)
    const relatedSeqs = [...new Set(nodes.filter(node => ids.has(node.id)).flatMap(node => node.relatedSeqs))].sort((left, right) => left - right)
    const summary: MemoNode = { id: nextId, kind: 'summary', notes: fold.notes, relatedSeqs, status: 'active' }
    nodes = [...nodes.map(node => ids.has(node.id) ? { ...node, status: 'folded' as const } : node), summary]
    const rewired: MemoEdge[] = []
    for (const edge of edges) {
      if (ids.has(edge.src) && ids.has(edge.dst)) continue
      if (!ids.has(edge.src) && ids.has(edge.dst)) rewired.push({ src: edge.src, dst: nextId, rationale: fold.rationale })
      else if (ids.has(edge.src) && !ids.has(edge.dst)) rewired.push({ src: nextId, dst: edge.dst, rationale: edge.rationale })
      else rewired.push(edge)
    }
    edges = rewired
    nextId += 1
  }
  assertAcyclic(nodes, edges)
  return { nodes, edges }
}

function storedEvent(event: Extract<SessionEvent, { type: 'user/message' }>): StoredEvent | undefined {
  if (event.data.source.kind !== 'plugin' || event.data.source.plugin !== MEMOBRAIN_SOURCE) return undefined
  try {
    return JSON.parse(contentText(event.data.content)) as StoredEvent
  } catch {
    return undefined
  }
}

/** Pure Session-event fold for MemoBrain graph construction and recall. */
export function foldMemoBrainState(state: MemoBrainState, event: SessionEvent): MemoBrainState {
  if (event.type === 'user/message') {
    const stored = storedEvent(event)
    if (stored?.kind === 'memory') {
      const episode = state.pendingEpisodes.find(candidate => candidate.id === stored.episodeId)
      if (episode === undefined) return state
      const pendingEpisodes = state.pendingEpisodes.filter(candidate => candidate.id !== episode.id)
      if (stored.patch === null) return { ...state, pendingEpisodes, processedEpisodes: state.processedEpisodes + 1 }
      const parsed = graphPatchSchema.safeParse(stored.patch)
      if (!parsed.success) return { ...state, pendingEpisodes, processedEpisodes: state.processedEpisodes + 1 }
      try {
        return { ...state, ...applyMemoGraphPatch(state, parsed.data, episode.relatedSeqs), pendingEpisodes, processedEpisodes: state.processedEpisodes + 1 }
      } catch {
        return { ...state, pendingEpisodes, processedEpisodes: state.processedEpisodes + 1 }
      }
    }
    if (stored?.kind === 'recall') {
      if (stored.patch === null) return { ...state, recalledEpisodes: state.processedEpisodes }
      const parsed = recallPatchSchema.safeParse(stored.patch)
      if (!parsed.success) return { ...state, recalledEpisodes: state.processedEpisodes }
      try {
        return { ...state, ...applyMemoRecall(state, parsed.data), recalledEpisodes: state.processedEpisodes }
      } catch {
        return { ...state, recalledEpisodes: state.processedEpisodes }
      }
    }
    if (event.data.source.kind === 'user' && state.originalTask === null) {
      const task = contentText(event.data.content)
      return {
        ...state,
        originalTask: task,
        nodes: [{ id: 1, kind: 'task', notes: [{ role: 'user', content: task }], relatedSeqs: [Number(event.seq)], status: 'active' }],
      }
    }
    return state
  }
  if (event.type === 'assistant/message') {
    return { ...state, assistants: { ...state.assistants, [String(event.data.step)]: { text: contentText(event.data.message.content), seq: Number(event.seq) } } }
  }
  if (event.type === 'tool/call') {
    return { ...state, pendingCalls: { ...state.pendingCalls, [String(event.data.callId)]: {
      step: event.data.step, tool: event.data.name, arguments: event.data.arguments, seq: Number(event.seq),
    } } }
  }
  if (event.type === 'tool/result') {
    const block = event.data.message.content[0]
    const id = String(block.toolCallId)
    const call = state.pendingCalls[id]
    if (call === undefined) return state
    const nextCalls = { ...state.pendingCalls }
    delete nextCalls[id]
    const assistant = state.assistants[String(call.step)]
    return {
      ...state,
      pendingCalls: nextCalls,
      pendingEpisodes: [...state.pendingEpisodes, {
        id, step: call.step, assistant: assistant?.text ?? '', tool: call.tool, arguments: call.arguments,
        result: contentText(block.content), isError: block.isError === true,
        relatedSeqs: [assistant?.seq, call.seq, Number(event.seq)].filter((seq): seq is number => seq !== undefined),
      }],
    }
  }
  return state
}

/** Durable MemoBrain reasoning-graph projection. */
export const memoBrainProjectionDefinition = {
  key: MEMOBRAIN_PROJECTION_KEY, stateSchema, init: initialMemoBrainState, apply: foldMemoBrainState, stateVersion: 1,
} satisfies ProjectionDefinition<typeof MEMOBRAIN_PROJECTION_KEY, MemoBrainState>

/** Render the active graph supplied to memory and recall calls. */
export function renderMemoGraph(state: MemoBrainState): string {
  const outgoing = new Map<number, MemoEdge[]>()
  for (const edge of state.edges) outgoing.set(edge.src, [...(outgoing.get(edge.src) ?? []), edge])
  return state.nodes.map(node => {
    const notes = node.notes.map(note => `${note.role}: ${note.content}`).join(' | ')
    const links = (outgoing.get(node.id) ?? []).map(edge => `${edge.dst} (${edge.rationale})`).join(', ') || 'none'
    return `Node ${node.id} [${node.kind}] [${node.status}] ${notes}\n  children: ${links}`
  }).join('\n') || '(empty graph)'
}

function episodePrompt(state: MemoBrainState, episode: MemoEpisode): string {
  return `CURRENT_GRAPH:\n${renderMemoGraph(state)}\n\nCURRENT_INTERACTION:\nassistant: ${episode.assistant}\ntool: ${episode.tool}\narguments: ${episode.arguments}\nresult: ${episode.result}\nerror: ${episode.isError}`
}

function recallPrompt(state: MemoBrainState): string {
  return `CURRENT_GRAPH:\n${renderMemoGraph(state)}`
}

function encodeStored(value: StoredEvent): string {
  return JSON.stringify(value)
}

function appendStored(agent: Agent, value: StoredEvent): void {
  const stored = agent.session.append('user/message', createUserMessage({
    source: { kind: 'plugin', plugin: MEMOBRAIN_SOURCE }, content: [{ type: 'text', text: encodeStored(value) }],
  }), { surfaceOp: 'append' })
  agent.session.append('user/message', createUserMessage({
    source: { kind: 'plugin', plugin: MEMOBRAIN_SOURCE },
    content: [{
      type: 'text',
      text: value.kind === 'memory'
        ? `MemoBrain passively recorded tool episode ${value.episodeId ?? '(unknown)'}. Continue the task; no response to this maintenance notice is needed.`
        : 'MemoBrain optimized the reasoning graph. Continue from the replacement checkpoint; no response to this maintenance notice is needed.',
    }],
  }), { surfaceOp: { op: 'replace', startSeq: stored.seq, endSeq: stored.seq }, sourceEventSeqs: [stored.seq] })
}

function eventTranscript(agent: Agent, seqs: readonly SessionSeq[]): string {
  return seqs.map(seq => {
    const event = agent.session.eventAt(seq)
    if (event === undefined) return ''
    if (event.type === 'user/message') return `user: ${contentText(event.data.content)}`
    if (event.type === 'assistant/message') return `assistant: ${contentText(event.data.message.content)}`
    if (event.type === 'tool/call') return `tool call ${event.data.name}: ${event.data.arguments}`
    if (event.type === 'tool/result') return `tool result: ${contentText(event.data.message.content[0].content)}`
    return ''
  }).filter(Boolean).join('\n')
}

/** Render the compact surface installed after a MemoBrain recall. */
export function renderMemoCheckpoint(state: MemoBrainState, protectedTranscript: string): string {
  return `Original task:\n${state.originalTask ?? '(unavailable)'}\n\nMemoBrain has optimized the earlier trajectory. Flushed nodes are invalid or superseded; folded nodes are represented by active summary nodes. Continue from this established state without repeating completed work.\n\n<memobrain-graph>\n${renderMemoGraph(state)}\n</memobrain-graph>\n\n<protected-transcript>\n${protectedTranscript || '(none)'}\n</protected-transcript>`
}

/** MemoBrain pressure policy and auxiliary response cap. */
export interface MemoBrainConfig {
  readonly thresholdRatio: number
  readonly auxiliaryMaxTokens: number
}

async function pressureDue(ctx: Context, agent: Agent, state: MemoBrainState, config: MemoBrainConfig, signal: AbortSignal): Promise<boolean> {
  if (state.processedEpisodes <= state.recalledEpisodes || state.nodes.length < 2) return false
  const target = agent.session.requestHeader()?.config
  if (target === undefined) return false
  const context = (await ctx.llm.resolveModelInfo(target.provider, target.model, signal)).context
  if (context === undefined) throw new Error(`MemoBrain cannot resolve the context window for ${target.provider}/${target.model}`)
  return ctx.tokenMeter.measure(agent.session).totalTokens >= Math.floor(context.contextWindow * config.thresholdRatio)
}

/** Install passive reasoning-graph memorization and pressure-triggered recall. */
export function applyMemoBrain(ctx: Context, config: MemoBrainConfig): void {
  if (!(config.thresholdRatio > 0 && config.thresholdRatio < 1)) throw new Error('memobrain thresholdRatio must be between 0 and 1')
  if (!Number.isSafeInteger(config.auxiliaryMaxTokens) || config.auxiliaryMaxTokens < 1) throw new Error('memobrain auxiliaryMaxTokens must be a positive safe integer')
  ctx.sessionProjections.register(memoBrainProjectionDefinition)
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    let state = ctx.sessionProjections.stateOf(agent.session, MEMOBRAIN_PROJECTION_KEY)
    if (state === undefined) return await next()
    for (const episode of state.pendingEpisodes) {
      let stored: StoredEvent
      try {
        const result = await auxiliaryText(ctx, agent, MEMORY_SYSTEM, episodePrompt(state, episode), config.auxiliaryMaxTokens, signal)
        const parsed = graphPatchSchema.parse(parseJson(result.text))
        applyMemoGraphPatch(state, parsed, episode.relatedSeqs)
        stored = { kind: 'memory', episodeId: episode.id, patch: parsed, rawOutput: result.text, provider: result.provider, model: result.model }
      } catch (error) {
        stored = { kind: 'memory', episodeId: episode.id, patch: null, rawOutput: '', provider: '', model: '', error: error instanceof Error ? error.message : String(error) }
        ctx.logger.warn(`MemoBrain skipped episode ${episode.id}: ${stored.error}`)
      }
      appendStored(agent, stored)
      state = ctx.sessionProjections.stateOf(agent.session, MEMOBRAIN_PROJECTION_KEY) ?? state
    }
    try {
      if (await pressureDue(ctx, agent, state, config, signal)) {
        let stored: StoredEvent
        try {
          const result = await auxiliaryText(ctx, agent, RECALL_SYSTEM, recallPrompt(state), config.auxiliaryMaxTokens, signal)
          const parsed = recallPatchSchema.parse(parseJson(result.text))
          applyMemoRecall(state, parsed)
          stored = { kind: 'recall', patch: parsed, rawOutput: result.text, provider: result.provider, model: result.model }
        } catch (error) {
          stored = { kind: 'recall', patch: null, rawOutput: '', provider: '', model: '', error: error instanceof Error ? error.message : String(error) }
          ctx.logger.warn(`MemoBrain recall used the unchanged graph: ${stored.error}`)
        }
        appendStored(agent, stored)
        state = ctx.sessionProjections.stateOf(agent.session, MEMOBRAIN_PROJECTION_KEY) ?? state
        const nodes = agent.session.surface.nodes
        const first = nodes[0]
        const start = first === undefined || agent.session.eventAt(first)?.type !== 'system/message' ? first : nodes[1]
        const end = nodes.at(-1)
        if (start !== undefined && end !== undefined) {
          const conversational = nodes.filter((seq) => {
            const event = agent.session.eventAt(seq)
            return event?.type === 'assistant/message'
              || event?.type === 'tool/call'
              || event?.type === 'tool/result'
              || (event?.type === 'user/message' && event.data.source.kind === 'user')
          })
          const protectedSeqs = [...new Set([...conversational.slice(0, 3), ...conversational.slice(-4)])]
          const checkpoint = createUserMessage({
            source: { kind: 'plugin', plugin: MEMOBRAIN_SOURCE },
            content: [{ type: 'text', text: renderMemoCheckpoint(state, eventTranscript(agent, protectedSeqs)) }],
          })
          agent.session.append('user/message', checkpoint, {
            surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: nodes.slice(nodes.indexOf(start)),
          })
        }
      }
    } catch (error) {
      ctx.logger.warn(`MemoBrain pressure check failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return await next()
  })
  registerHarnessPrompt(ctx, {
    id: 'memobrain',
    text: 'Operate as a direct ReAct agent with passive MemoBrain executive memory. Use tools when needed and finish only when evidence supports the answer. MemoBrain automatically records each completed tool episode in a dependency graph and, under context pressure, flushes invalid or superseded nodes and folds completed paths. Treat any MemoBrain checkpoint as established task state; do not repeat completed work.',
  })
}
