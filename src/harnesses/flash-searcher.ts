import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { assertValidDag, readyDagNodeIds } from '../runtime/dag.js'
import { registerHarnessPrompt } from '../runtime/prompt.js'

const SUBMIT_DAG_TOOL = 'submit_dag_plan'
const REVIEW_DAG_TOOL = 'record_dag_review'

/** Host projection key for the durable Flash-Searcher graph and reviews. */
export const FLASH_SEARCHER_PROJECTION_KEY = 'harness-all-in-dsh/flash-searcher' as const

/** One sequential fallback path within a Flash-Searcher goal. */
export interface FlashPath {
  readonly approach: string
  readonly successCriteria: string
}

/** One DAG goal; independent ready goals may execute concurrently. */
export interface FlashGoal {
  readonly id: string
  readonly name: string
  readonly dependsOn: readonly string[]
  readonly paths: readonly FlashPath[]
}

/** Periodic evidence-based status for one goal. */
export interface FlashGoalReview {
  readonly goalId: string
  readonly status: 'pending' | 'in-progress' | 'completed' | 'blocked'
  readonly activePath: number | null
  readonly result: string
  readonly nextAction: string
}

/** Replayable Flash-Searcher controller state derived only from Session events. */
export interface FlashSearcherState {
  readonly goals: readonly FlashGoal[] | null
  readonly latestReview: readonly FlashGoalReview[] | null
  readonly actionSteps: number
  readonly reviewedAt: number
  readonly managementStep: number | null
  readonly pendingPlan: { readonly callId: string; readonly goals: readonly FlashGoal[] } | null
  readonly pendingReview: { readonly callId: string; readonly review: readonly FlashGoalReview[] } | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Flash-Searcher DAG, execution status, and review cadence. */
    [FLASH_SEARCHER_PROJECTION_KEY]: FlashSearcherState
  }
}

const pathSchema = z.object({
  approach: z.string(),
  successCriteria: z.string(),
})
const goalSchema = z.object({
  id: z.string(),
  name: z.string(),
  dependsOn: z.array(z.string()),
  paths: z.array(pathSchema),
})
const reviewSchema = z.object({
  goalId: z.string(),
  status: z.enum(['pending', 'in-progress', 'completed', 'blocked']),
  activePath: z.number().int().positive().nullable(),
  result: z.string(),
  nextAction: z.string(),
})
const stateSchema: z.ZodType<FlashSearcherState> = z.object({
  goals: z.array(goalSchema).nullable(),
  latestReview: z.array(reviewSchema).nullable(),
  actionSteps: z.number().int().nonnegative(),
  reviewedAt: z.number().int().nonnegative(),
  managementStep: z.number().int().nonnegative().nullable(),
  pendingPlan: z.object({ callId: z.string(), goals: z.array(goalSchema) }).nullable(),
  pendingReview: z.object({ callId: z.string(), review: z.array(reviewSchema) }).nullable(),
})

/** Create the empty controller state before graph planning. */
export function initialFlashSearcherState(): FlashSearcherState {
  return {
    goals: null,
    latestReview: null,
    actionSteps: 0,
    reviewedAt: 0,
    managementStep: null,
    pendingPlan: null,
    pendingReview: null,
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parsedArguments(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function goalsFromArguments(value: unknown): readonly FlashGoal[] | undefined {
  if (typeof value !== 'object' || value === null || !('goals' in value)) return undefined
  const goals = (value as { goals?: unknown }).goals
  if (!Array.isArray(goals) || goals.length < 1 || goals.length > 5) return undefined
  const normalized: FlashGoal[] = []
  for (const candidate of goals) {
    if (typeof candidate !== 'object' || candidate === null) return undefined
    const goal = candidate as { id?: unknown; name?: unknown; dependsOn?: unknown; paths?: unknown }
    if (!nonEmpty(goal.id) || !nonEmpty(goal.name) || !Array.isArray(goal.dependsOn)
      || !goal.dependsOn.every(nonEmpty) || !Array.isArray(goal.paths)
      || goal.paths.length < 1 || goal.paths.length > 5) return undefined
    const paths: FlashPath[] = []
    for (const candidatePath of goal.paths) {
      if (typeof candidatePath !== 'object' || candidatePath === null) return undefined
      const path = candidatePath as { approach?: unknown; successCriteria?: unknown }
      if (!nonEmpty(path.approach) || !nonEmpty(path.successCriteria)) return undefined
      paths.push({ approach: path.approach.trim(), successCriteria: path.successCriteria.trim() })
    }
    normalized.push({
      id: goal.id.trim(),
      name: goal.name.trim(),
      dependsOn: goal.dependsOn.map(dependency => dependency.trim()),
      paths,
    })
  }
  try {
    assertValidDag(normalized)
  } catch {
    return undefined
  }
  return normalized
}

function reviewFromArguments(
  value: unknown,
  goals: readonly FlashGoal[] | null,
): readonly FlashGoalReview[] | undefined {
  if (goals === null || typeof value !== 'object' || value === null || !('goals' in value)) return undefined
  const reviews = (value as { goals?: unknown }).goals
  if (!Array.isArray(reviews) || reviews.length !== goals.length) return undefined
  const goalById = new Map(goals.map(goal => [goal.id, goal]))
  const seen = new Set<string>()
  const normalized: FlashGoalReview[] = []
  for (const candidate of reviews) {
    if (typeof candidate !== 'object' || candidate === null) return undefined
    const review = candidate as Record<string, unknown>
    if (!nonEmpty(review.goalId) || seen.has(review.goalId)) return undefined
    const goal = goalById.get(review.goalId)
    if (goal === undefined) return undefined
    if (review.status !== 'pending' && review.status !== 'in-progress'
      && review.status !== 'completed' && review.status !== 'blocked') return undefined
    if (review.activePath !== null
      && (!Number.isSafeInteger(review.activePath) || (review.activePath as number) < 1
        || (review.activePath as number) > goal.paths.length)) return undefined
    if (!nonEmpty(review.result) || !nonEmpty(review.nextAction)) return undefined
    seen.add(review.goalId)
    normalized.push({
      goalId: review.goalId,
      status: review.status,
      activePath: review.activePath as number | null,
      result: review.result.trim(),
      nextAction: review.nextAction.trim(),
    })
  }
  const completed = new Set(normalized.filter(item => item.status === 'completed').map(item => item.goalId))
  for (const item of normalized) {
    if (item.status !== 'completed') continue
    const goal = goalById.get(item.goalId)
    if (goal?.dependsOn.some(dependency => !completed.has(dependency)) === true) return undefined
  }
  return normalized
}

function resultCallId(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return String(event.data.message.content[0].toolCallId)
}

/** Pure event fold used by the Session projection and replay tests. */
export function foldFlashSearcherState(
  state: FlashSearcherState,
  event: SessionEvent,
): FlashSearcherState {
  if (event.type === 'tool/call' && event.data.name === SUBMIT_DAG_TOOL) {
    const goals = goalsFromArguments(parsedArguments(event.data.arguments))
    if (goals === undefined) return state
    return { ...state, managementStep: event.data.step, pendingPlan: { callId: String(event.data.callId), goals } }
  }
  if (event.type === 'tool/call' && event.data.name === REVIEW_DAG_TOOL) {
    const review = reviewFromArguments(parsedArguments(event.data.arguments), state.goals)
    if (review === undefined) return state
    return { ...state, managementStep: event.data.step, pendingReview: { callId: String(event.data.callId), review } }
  }
  if (event.type === 'tool/result') {
    const callId = resultCallId(event)
    const isError = event.data.message.content[0].isError
    if (state.pendingPlan?.callId === callId) {
      return { ...state, goals: isError ? state.goals : state.pendingPlan.goals, pendingPlan: null }
    }
    if (state.pendingReview?.callId === callId) {
      return {
        ...state,
        latestReview: isError ? state.latestReview : state.pendingReview.review,
        reviewedAt: isError ? state.reviewedAt : state.actionSteps,
        pendingReview: null,
      }
    }
    return state
  }
  if (event.type === 'step/end' && state.goals !== null) {
    if (state.managementStep === event.data.step) return { ...state, managementStep: null }
    return { ...state, actionSteps: state.actionSteps + 1 }
  }
  return state
}

/** Durable projection for Flash-Searcher graph planning and progress review. */
export const flashSearcherProjectionDefinition = {
  key: FLASH_SEARCHER_PROJECTION_KEY,
  stateSchema,
  init: initialFlashSearcherState,
  apply: foldFlashSearcherState,
  stateVersion: 1,
} satisfies ProjectionDefinition<typeof FLASH_SEARCHER_PROJECTION_KEY, FlashSearcherState>

function reviewDue(state: FlashSearcherState, interval: number): boolean {
  return state.goals !== null && state.actionSteps > 0
    && state.actionSteps % interval === 0 && state.reviewedAt < state.actionSteps
}

/** Render the current DAG directive from replayed state. */
export function renderFlashSearcherPrompt(state: FlashSearcherState, interval: number): string {
  if (state.goals === null) {
    return `Operate as Flash-Searcher. Before using task tools, call ${SUBMIT_DAG_TOOL} with 1-5 goals. Give each goal a stable id, explicit dependencies, and 1-5 sequential fallback paths with success criteria. The dependencies must form a DAG.`
  }
  const completed = new Set(
    state.latestReview?.filter(item => item.status === 'completed').map(item => item.goalId) ?? [],
  )
  const ready = readyDagNodeIds(state.goals, completed)
  const graph = state.goals.map((goal) => {
    const dependencies = goal.dependsOn.length === 0 ? '(none)' : goal.dependsOn.join(', ')
    const paths = goal.paths.map((path, index) => `  Path ${index + 1}: ${path.approach} | Success: ${path.successCriteria}`).join('\n')
    return `Goal ${goal.id} — ${goal.name}\n  Depends on: ${dependencies}\n${paths}`
  }).join('\n\n')
  const review = state.latestReview === null ? '(none yet)' : state.latestReview
    .map(item => `${item.goalId}: ${item.status}; path=${item.activePath ?? 'none'}; result=${item.result}; next=${item.nextAction}`)
    .join('\n')
  const periodic = reviewDue(state, interval)
    ? `\n\nBefore another task action, call ${REVIEW_DAG_TOOL}. Report every goal, evidence-based status, active fallback path, result so far, and next action.`
    : ''
  return `Operate as Flash-Searcher with the durable DAG below. Advance all ready unresolved goals concurrently when their tool calls are independent. Within one goal, use one path at a time and move to a later path only when the current path fails, stalls, or misses its success criteria. Do not mark a goal complete without evidence. Call ${REVIEW_DAG_TOOL} whenever evidence changes a goal's status or active path so dependent goals can become ready; the Harness also requires a complete review periodically. DSH may execute up to five tool calls from one response concurrently; use those slots across different ready goals. Finalize only after every required goal is resolved.\n\nReady goals: ${ready.join(', ') || '(none)'}\n\nDAG:\n${graph}\n\nLatest review:\n${review}${periodic}`
}

function requireAgent(exec: ToolExecution, toolName: string): Agent {
  if (exec.agent === undefined) throw new Error(`${toolName} requires an owning DSH Agent`)
  return exec.agent
}

function submitDagTool(): ToolDefinition {
  return {
    name: SUBMIT_DAG_TOOL,
    description: 'Submit the initial 1-5 goal dependency DAG with sequential fallback paths.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        goals: { type: 'array', minItems: 1, maxItems: 5, items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
            dependsOn: { type: 'array', items: { type: 'string' } },
            paths: { type: 'array', minItems: 1, maxItems: 5, items: {
              type: 'object', additionalProperties: false,
              properties: { approach: { type: 'string', minLength: 1 }, successCriteria: { type: 'string', minLength: 1 } },
              required: ['approach', 'successCriteria'],
            } },
          },
          required: ['id', 'name', 'dependsOn', 'paths'],
        } },
      }, required: ['goals'],
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'Flash-Searcher DAG accepted.' }] },
    async execute(args, exec) {
      requireAgent(exec, SUBMIT_DAG_TOOL)
      const goals = goalsFromArguments(args)
      if (goals === undefined) throw new Error('submit_dag_plan requires a valid acyclic 1-5 goal graph')
      return { goals }
    },
  }
}

function reviewDagTool(ctx: Context): ToolDefinition {
  return {
    name: REVIEW_DAG_TOOL,
    description: 'Record evidence-based status for every DAG goal after a transition or required periodic review.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { goals: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: {
          goalId: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in-progress', 'completed', 'blocked'] },
          activePath: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
          result: { type: 'string', minLength: 1 }, nextAction: { type: 'string', minLength: 1 },
        }, required: ['goalId', 'status', 'activePath', 'result', 'nextAction'],
      } } }, required: ['goals'],
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'DAG status review recorded.' }] },
    async execute(args, exec) {
      const agent = requireAgent(exec, REVIEW_DAG_TOOL)
      const state = ctx.sessionProjections.stateOf(agent.session, FLASH_SEARCHER_PROJECTION_KEY)
      const review = reviewFromArguments(args, state?.goals ?? null)
      if (review === undefined) throw new Error('record_dag_review requires one valid status for every DAG goal')
      return { goals: review }
    },
  }
}

/** Tunable periodic graph-review cadence. */
export interface FlashSearcherConfig {
  readonly summaryInterval: number
}

/** Install DAG planning, replayable reviews, and execution guards. */
export function applyFlashSearcher(ctx: Context, config: FlashSearcherConfig): void {
  if (!Number.isSafeInteger(config.summaryInterval) || config.summaryInterval < 1) {
    throw new Error('flash-searcher summaryInterval must be a positive safe integer')
  }
  ctx.sessionProjections.register(flashSearcherProjectionDefinition)
  ctx.tools.register(submitDagTool())
  ctx.tools.register(reviewDagTool(ctx))
  ctx.tools.guard((exec) => {
    if (exec.agent === undefined) return undefined
    const state = ctx.sessionProjections.stateOf(exec.agent.session, FLASH_SEARCHER_PROJECTION_KEY)
    if (state === undefined) return 'Flash-Searcher projection is unavailable'
    if (state.goals === null) {
      if (exec.name !== SUBMIT_DAG_TOOL) return `Call ${SUBMIT_DAG_TOOL} before task tools.`
      return undefined
    }
    if (reviewDue(state, config.summaryInterval)) return exec.name === REVIEW_DAG_TOOL || exec.name.startsWith('gam_') ? undefined : `Call ${REVIEW_DAG_TOOL} before the next task action.`
    if (exec.name === SUBMIT_DAG_TOOL) return 'The initial DAG is already fixed.'
    return undefined
  })
  registerHarnessPrompt(ctx, {
    id: 'flash-searcher',
    text: ({ agent }) => {
      if (agent === undefined) return ''
      const state = ctx.sessionProjections.stateOf(agent.session, FLASH_SEARCHER_PROJECTION_KEY)
      if (state === undefined) throw new Error('Flash-Searcher projection is unavailable')
      return renderFlashSearcherPrompt(state, config.summaryInterval)
    },
  })
}
