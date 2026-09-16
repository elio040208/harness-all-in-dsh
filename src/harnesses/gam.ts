import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { applyFlashSearcher } from './flash-searcher.js'
import { registerHarnessPrompt } from '../runtime/prompt.js'

const MEMORIZE_TOOL = 'gam_memorize_pages'
const SEARCH_TOOL = 'gam_search_pages'
const INTEGRATE_TOOL = 'gam_integrate_memory'
const GAM_SOURCE = 'harness-all-in-dsh:gam'

/** Host projection key for the durable GAM page store and integrated memory. */
export const GAM_PROJECTION_KEY = 'harness-all-in-dsh/gam' as const

/** One complete trajectory page plus its lightweight Memorizer abstract. */
export interface GamPage {
  readonly id: string
  readonly step: number
  readonly tool: string
  readonly arguments: string
  readonly content: string
  readonly isError: boolean
  readonly abstract: string | null
}

/** Replayable GAM state derived from ordinary tool and replacement events. */
export interface GamState {
  readonly originalTask: string | null
  readonly pages: readonly GamPage[]
  readonly integratedMemory: string | null
  readonly integratedSources: readonly string[]
  readonly actionSteps: number
  readonly integratedAt: number
  readonly foldedAt: number
  readonly taskSteps: readonly number[]
  readonly pendingCalls: Readonly<Record<string, { readonly step: number; readonly tool: string; readonly arguments: string }>>
  readonly pendingAbstracts: { readonly callId: string; readonly entries: readonly { readonly pageId: string; readonly abstract: string }[] } | null
  readonly pendingIntegration: { readonly callId: string; readonly summary: string; readonly sourcePageIds: readonly string[] } | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** GAM complete pages, abstracts, and last integrated research context. */
    [GAM_PROJECTION_KEY]: GamState
  }
}

const pageSchema = z.object({
  id: z.string(), step: z.number().int().nonnegative(), tool: z.string(), arguments: z.string(),
  content: z.string(), isError: z.boolean(), abstract: z.string().nullable(),
})
const pendingCallSchema = z.object({ step: z.number().int().nonnegative(), tool: z.string(), arguments: z.string() })
const stateSchema: z.ZodType<GamState> = z.object({
  originalTask: z.string().nullable(), pages: z.array(pageSchema), integratedMemory: z.string().nullable(), integratedSources: z.array(z.string()),
  actionSteps: z.number().int().nonnegative(), integratedAt: z.number().int().nonnegative(), foldedAt: z.number().int().nonnegative(),
  taskSteps: z.array(z.number().int().nonnegative()), pendingCalls: z.record(z.string(), pendingCallSchema),
  pendingAbstracts: z.object({ callId: z.string(), entries: z.array(z.object({ pageId: z.string(), abstract: z.string() })) }).nullable(),
  pendingIntegration: z.object({ callId: z.string(), summary: z.string(), sourcePageIds: z.array(z.string()) }).nullable(),
})

/** Create the empty per-session GAM state. */
export function initialGamState(): GamState {
  return {
    originalTask: null, pages: [], integratedMemory: null, integratedSources: [], actionSteps: 0,
    integratedAt: 0, foldedAt: 0, taskSteps: [], pendingCalls: {},
    pendingAbstracts: null, pendingIntegration: null,
  }
}

function parsed(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return undefined }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function managementTool(name: string): boolean {
  return name === 'submit_dag_plan' || name === 'record_dag_review' || name.startsWith('gam_')
}

function resultText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(resultText).filter(Boolean).join('\n')
  if (typeof value !== 'object' || value === null) return String(value ?? '')
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if ('content' in record) return resultText(record.content)
  return JSON.stringify(value)
}

function abstractEntries(value: unknown, pages: readonly GamPage[]): readonly { pageId: string; abstract: string }[] | undefined {
  if (typeof value !== 'object' || value === null || !('pages' in value)) return undefined
  const candidates = (value as { pages?: unknown }).pages
  const missing = pages.filter(page => page.abstract === null)
  if (!Array.isArray(candidates) || candidates.length !== missing.length) return undefined
  const missingIds = new Set(missing.map(page => page.id))
  const seen = new Set<string>()
  const entries: { pageId: string; abstract: string }[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) return undefined
    const entry = candidate as { pageId?: unknown; abstract?: unknown }
    if (!nonEmpty(entry.pageId) || !nonEmpty(entry.abstract)
      || !missingIds.has(entry.pageId) || seen.has(entry.pageId)) return undefined
    seen.add(entry.pageId)
    entries.push({ pageId: entry.pageId, abstract: entry.abstract.trim() })
  }
  return entries
}

function integration(value: unknown, pages: readonly GamPage[]): { summary: string; sourcePageIds: readonly string[] } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const input = value as { summary?: unknown; sourcePageIds?: unknown }
  if (!nonEmpty(input.summary) || !Array.isArray(input.sourcePageIds)
    || !input.sourcePageIds.every(nonEmpty)) return undefined
  const pageIds = new Set(pages.map(page => page.id))
  const sources = [...new Set(input.sourcePageIds.map(id => id.trim()))]
  if (sources.some(id => !pageIds.has(id))) return undefined
  return { summary: input.summary.trim(), sourcePageIds: sources }
}

function callId(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return String(event.data.message.content[0].toolCallId)
}

/** Pure Session-event fold for complete pages and model-written abstracts. */
export function foldGamState(state: GamState, event: SessionEvent): GamState {
  if (event.type === 'tool/call') {
    const id = String(event.data.callId)
    if (event.data.name === MEMORIZE_TOOL) {
      const entries = abstractEntries(parsed(event.data.arguments), state.pages)
      return entries === undefined ? state : { ...state, pendingAbstracts: { callId: id, entries } }
    }
    if (event.data.name === INTEGRATE_TOOL) {
      const update = integration(parsed(event.data.arguments), state.pages)
      return update === undefined ? state : { ...state, pendingIntegration: { callId: id, ...update } }
    }
    if (managementTool(event.data.name)) return state
    return {
      ...state,
      taskSteps: state.taskSteps.includes(event.data.step) ? state.taskSteps : [...state.taskSteps, event.data.step],
      pendingCalls: { ...state.pendingCalls, [id]: { step: event.data.step, tool: event.data.name, arguments: event.data.arguments } },
    }
  }
  if (event.type === 'tool/result') {
    const id = callId(event)
    const failed = event.data.message.content[0].isError
    if (state.pendingAbstracts?.callId === id) {
      const abstracts = failed ? new Map<string, string>() : new Map(state.pendingAbstracts.entries.map(entry => [entry.pageId, entry.abstract]))
      return { ...state, pages: state.pages.map(page => ({ ...page, abstract: abstracts.get(page.id) ?? page.abstract })), pendingAbstracts: null }
    }
    if (state.pendingIntegration?.callId === id) {
      return {
        ...state,
        integratedMemory: failed ? state.integratedMemory : state.pendingIntegration.summary,
        integratedSources: failed ? state.integratedSources : state.pendingIntegration.sourcePageIds,
        integratedAt: failed ? state.integratedAt : state.actionSteps,
        pendingIntegration: null,
      }
    }
    const pending = state.pendingCalls[id]
    if (pending === undefined) return state
    const nextPending = { ...state.pendingCalls }
    delete nextPending[id]
    const block = event.data.message.content[0]
    return {
      ...state,
      pages: [...state.pages, {
        id: `page-${state.pages.length}`,
        step: pending.step,
        tool: pending.tool,
        arguments: pending.arguments,
        content: resultText(block.content),
        isError: block.isError === true,
        abstract: null,
      }],
      pendingCalls: nextPending,
    }
  }
  if (event.type === 'step/end' && state.taskSteps.includes(event.data.step)) {
    return { ...state, actionSteps: state.actionSteps + 1 }
  }
  if (event.type === 'user/message') {
    if (event.data.source.kind === 'user' && state.originalTask === null) {
      return { ...state, originalTask: resultText(event.data.content) }
    }
    if (event.data.source.kind === 'plugin' && event.data.source.plugin === GAM_SOURCE) {
      return { ...state, foldedAt: state.integratedAt }
    }
  }
  return state
}

/** Durable GAM page-store projection. */
export const gamProjectionDefinition = {
  key: GAM_PROJECTION_KEY, stateSchema, init: initialGamState, apply: foldGamState, stateVersion: 1,
} satisfies ProjectionDefinition<typeof GAM_PROJECTION_KEY, GamState>

function requireAgent(exec: ToolExecution, name: string): Agent {
  if (exec.agent === undefined) throw new Error(`${name} requires an owning DSH Agent`)
  return exec.agent
}

function memorizeTool(ctx: Context): ToolDefinition {
  return {
    name: MEMORIZE_TOOL,
    description: 'Write one concise factual abstract for every new complete GAM page.',
    parameters: { type: 'object', additionalProperties: false, properties: { pages: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { pageId: { type: 'string' }, abstract: { type: 'string', minLength: 1 } },
      required: ['pageId', 'abstract'],
    } } }, required: ['pages'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'GAM page abstracts stored.' }] },
    async execute(args, exec) {
      const agent = requireAgent(exec, MEMORIZE_TOOL)
      const state = ctx.sessionProjections.stateOf(agent.session, GAM_PROJECTION_KEY)
      const entries = abstractEntries(args, state?.pages ?? [])
      if (entries === undefined) throw new Error('gam_memorize_pages must abstract every currently unmemorized page exactly once')
      return { pages: entries }
    },
  }
}

function scorePage(page: GamPage, terms: readonly string[]): number {
  const haystack = `${page.abstract ?? ''}\n${page.content}`.toLocaleLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term.toLocaleLowerCase()) ? 1 : 0), 0)
}

function searchTool(ctx: Context): ToolDefinition {
  return {
    name: SEARCH_TOOL,
    description: 'Retrieve complete GAM pages by exact keywords and/or known page ids.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      keywords: { type: 'array', maxItems: 10, items: { type: 'string' } },
      pageIds: { type: 'array', maxItems: 5, items: { type: 'string' } },
      topK: { type: 'integer', minimum: 1, maximum: 10 },
    }, required: ['keywords', 'pageIds', 'topK'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const agent = requireAgent(exec, SEARCH_TOOL)
      const state = ctx.sessionProjections.stateOf(agent.session, GAM_PROJECTION_KEY)
      if (state === undefined) throw new Error('GAM projection is unavailable')
      const input = args as { keywords?: unknown; pageIds?: unknown; topK?: unknown }
      if (!Array.isArray(input.keywords) || !input.keywords.every(nonEmpty)
        || !Array.isArray(input.pageIds) || !input.pageIds.every(nonEmpty)
        || !Number.isSafeInteger(input.topK) || (input.topK as number) < 1 || (input.topK as number) > 10) {
        throw new Error('gam_search_pages requires valid keywords, pageIds, and topK')
      }
      const requested = new Set(input.pageIds as string[])
      const ranked = state.pages.map(page => ({ page, score: requested.has(page.id) ? Number.MAX_SAFE_INTEGER : scorePage(page, input.keywords as string[]) }))
        .filter(hit => hit.score > 0).sort((left, right) => right.score - left.score).slice(0, input.topK as number)
      return { pages: ranked.map(({ page, score }) => ({ ...page, score })) }
    },
  }
}

function integrateTool(ctx: Context): ToolDefinition {
  return {
    name: INTEGRATE_TOOL,
    description: 'Store a consolidated factual GAM memory after retrieving relevant complete pages.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      summary: { type: 'string', minLength: 1 }, sourcePageIds: { type: 'array', items: { type: 'string' } },
    }, required: ['summary', 'sourcePageIds'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'Integrated GAM memory stored; raw history will be folded.' }] },
    async execute(args, exec) {
      const agent = requireAgent(exec, INTEGRATE_TOOL)
      const state = ctx.sessionProjections.stateOf(agent.session, GAM_PROJECTION_KEY)
      const update = integration(args, state?.pages ?? [])
      if (update === undefined) throw new Error('gam_integrate_memory requires a factual summary and valid source page ids')
      return update
    },
  }
}

/** GAM cadence and retained recent raw surface units. */
export interface GamConfig {
  readonly summaryInterval: number
  readonly reorgInterval: number
}

function reorgDue(state: GamState, interval: number): boolean {
  return state.actionSteps > state.integratedAt && state.actionSteps - state.integratedAt >= interval
}

/** Render the Memorizer catalogue and current Researcher result. */
export function renderGamPrompt(state: GamState, interval: number): string {
  const missing = state.pages.filter(page => page.abstract === null)
  const catalog = state.pages.map(page => `${page.id}: ${page.abstract ?? '(abstract pending)'}`).join('\n') || '(empty)'
  const integrated = state.integratedMemory ?? '(none yet)'
  const directive = missing.length > 0
    ? `Before another task tool, call ${MEMORIZE_TOOL} with one self-contained factual abstract for each pending page: ${missing.map(page => page.id).join(', ')}.`
    : reorgDue(state, interval)
      ? `GAM research is due. Use ${SEARCH_TOOL} one or more times over the abstract catalogue, then call ${INTEGRATE_TOOL} with a consolidated factual memory and the supporting page ids before another task action.`
      : 'Continue the DAG-guided task. Search the page store whenever older exact evidence is needed.'
  return `Use General Agentic Memory (GAM). Complete tool observations are retained as immutable pages; concise abstracts are the lightweight MemoryStore. Research retrieves full pages just in time and integrates only facts relevant to the original task. Do not invent page ids or facts.\n\n${directive}\n\nIntegrated memory:\n${integrated}\n\nMemory catalogue:\n${catalog}`
}

/** Render the compact model surface installed after GAM research integration. */
export function renderGamCheckpoint(state: GamState): string {
  return `Original task:\n${state.originalTask ?? '(unavailable)'}\n\nThe task progress has been reorganized by GAM. The actions summarized below are already complete: do not repeat them. Treat this integrated memory as established context and continue from the next unresolved action.\n\n<gam-integrated-memory>\n${state.integratedMemory ?? '(none yet)'}\n</gam-integrated-memory>`
}

/** Install Flash planning plus GAM Memorizer, Researcher tools, and surface folding. */
export function applyGam(ctx: Context, config: GamConfig): void {
  if (!Number.isSafeInteger(config.reorgInterval) || config.reorgInterval < 1) throw new Error('gam reorgInterval must be a positive safe integer')
  applyFlashSearcher(ctx, { summaryInterval: config.summaryInterval })
  ctx.sessionProjections.register(gamProjectionDefinition)
  ctx.tools.register(memorizeTool(ctx))
  ctx.tools.register(searchTool(ctx))
  ctx.tools.register(integrateTool(ctx))
  ctx.tools.guard((exec) => {
    if (exec.agent === undefined) return undefined
    const state = ctx.sessionProjections.stateOf(exec.agent.session, GAM_PROJECTION_KEY)
    if (state === undefined) return 'GAM projection is unavailable'
    if (state.pages.some(page => page.abstract === null)) {
      return managementTool(exec.name) ? undefined : `Call ${MEMORIZE_TOOL} before another task tool.`
    }
    if (reorgDue(state, config.reorgInterval)) {
      return managementTool(exec.name) ? undefined : `Research GAM pages and call ${INTEGRATE_TOOL} before another task tool.`
    }
    return undefined
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const state = ctx.sessionProjections.stateOf(agent.session, GAM_PROJECTION_KEY)
    if (state === undefined || state.integratedMemory === null || state.integratedAt <= state.foldedAt) return await next()
    const nodes = agent.session.surface.nodes
    const first = nodes[0]
    const start = first === undefined || agent.session.eventAt(first)?.type !== 'system/message' ? first : nodes[1]
    const end = nodes.at(-1)
    if (start === undefined || end === undefined) return await next()
    const sourceEventSeqs = nodes.slice(nodes.indexOf(start))
    const checkpoint = createUserMessage({
      source: { kind: 'plugin', plugin: GAM_SOURCE },
      content: [{ type: 'text', text: renderGamCheckpoint(state) }],
    })
    agent.session.append('user/message', checkpoint, {
      surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
      sourceEventSeqs,
    })
    return await next()
  })
  registerHarnessPrompt(ctx, {
    id: 'gam',
    text: ({ agent }) => {
      if (agent === undefined) return ''
      const state = ctx.sessionProjections.stateOf(agent.session, GAM_PROJECTION_KEY)
      if (state === undefined) throw new Error('GAM projection is unavailable')
      return renderGamPrompt(state, config.reorgInterval)
    },
  })
}
