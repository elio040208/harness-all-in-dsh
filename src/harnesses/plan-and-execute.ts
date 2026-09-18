import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { registerHarnessPrompt } from '../runtime/prompt.js'
import { installHarnessProtocol } from '../runtime/protocol.js'
import { isHarnessProtocolDenialResult } from '../runtime/protocol.js'
import type { HarnessProtocolPhase } from '../runtime/protocol.js'

const SUBMIT_PLAN_TOOL = 'submit_plan'
const RECORD_PROGRESS_TOOL = 'record_progress'

/** Host projection key for the durable linear roadmap and summary cadence. */
export const PLAN_AND_EXECUTE_PROJECTION_KEY = 'harness-all-in-dsh/linear-plan' as const

/** Replayable Plan-and-Execute controller state derived only from Session events. */
export interface LinearPlanState {
  readonly plan: readonly string[] | null
  readonly latestSummary: string | null
  readonly actionSteps: number
  readonly summarizedAt: number
  readonly managementStep: number | null
  readonly pendingPlan: { readonly callId: string; readonly steps: readonly string[] } | null
  readonly pendingSummary: { readonly callId: string; readonly summary: string } | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Plan-and-Execute roadmap, progress summary, and summary cadence. */
    [PLAN_AND_EXECUTE_PROJECTION_KEY]: LinearPlanState
  }
}

const stateSchema: z.ZodType<LinearPlanState> = z.object({
  plan: z.array(z.string()).nullable(),
  latestSummary: z.string().nullable(),
  actionSteps: z.number().int().nonnegative(),
  summarizedAt: z.number().int().nonnegative(),
  managementStep: z.number().int().nonnegative().nullable(),
  pendingPlan: z.object({ callId: z.string(), steps: z.array(z.string()) }).nullable(),
  pendingSummary: z.object({ callId: z.string(), summary: z.string() }).nullable(),
})

/** Create the empty controller state used before the initial roadmap call. */
export function initialLinearPlanState(): LinearPlanState {
  return {
    plan: null,
    latestSummary: null,
    actionSteps: 0,
    summarizedAt: 0,
    managementStep: null,
    pendingPlan: null,
    pendingSummary: null,
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stepsFromArguments(value: unknown): readonly string[] | undefined {
  if (typeof value !== 'object' || value === null || !('steps' in value)) return undefined
  const steps = (value as { steps?: unknown }).steps
  if (!Array.isArray(steps) || steps.length < 3 || steps.length > 7 || !steps.every(nonEmptyString)) return undefined
  return steps.map(step => step.trim())
}

function summaryFromArguments(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('summary' in value)) return undefined
  const summary = (value as { summary?: unknown }).summary
  return nonEmptyString(summary) ? summary.trim() : undefined
}

function parsedArguments(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function resultCallId(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return String(event.data.message.content[0].toolCallId)
}

/** Pure event fold used by the Session projection and focused replay tests. */
export function foldLinearPlanState(state: LinearPlanState, event: SessionEvent): LinearPlanState {
  if (event.type === 'tool/call' && event.data.name === SUBMIT_PLAN_TOOL) {
    const steps = stepsFromArguments(parsedArguments(event.data.arguments))
    if (steps === undefined) return state
    return {
      ...state,
      managementStep: event.data.step,
      pendingPlan: { callId: String(event.data.callId), steps },
    }
  }
  if (event.type === 'tool/call' && event.data.name === RECORD_PROGRESS_TOOL) {
    const summary = summaryFromArguments(parsedArguments(event.data.arguments))
    if (summary === undefined) return state
    return {
      ...state,
      managementStep: event.data.step,
      pendingSummary: { callId: String(event.data.callId), summary },
    }
  }
  if (event.type === 'tool/result') {
    const callId = resultCallId(event)
    if (isHarnessProtocolDenialResult(event)) return {
      ...state,
      managementStep: event.data.step,
      pendingPlan: state.pendingPlan?.callId === callId ? null : state.pendingPlan,
      pendingSummary: state.pendingSummary?.callId === callId ? null : state.pendingSummary,
    }
    const isError = event.data.message.content[0].isError
    if (state.pendingPlan?.callId === callId) {
      return {
        ...state,
        plan: isError ? state.plan : state.pendingPlan.steps,
        pendingPlan: null,
      }
    }
    if (state.pendingSummary?.callId === callId) {
      return {
        ...state,
        latestSummary: isError ? state.latestSummary : state.pendingSummary.summary,
        summarizedAt: isError ? state.summarizedAt : state.actionSteps,
        pendingSummary: null,
      }
    }
    return state
  }
  if (event.type === 'step/end' && state.plan !== null) {
    if (state.managementStep === event.data.step) return { ...state, managementStep: null }
    return { ...state, actionSteps: state.actionSteps + 1 }
  }
  return state
}

/** Durable host projection for roadmap and periodic progress state. */
export const linearPlanProjectionDefinition = {
  key: PLAN_AND_EXECUTE_PROJECTION_KEY,
  stateSchema,
  init: initialLinearPlanState,
  apply: foldLinearPlanState,
  stateVersion: 1,
} satisfies ProjectionDefinition<typeof PLAN_AND_EXECUTE_PROJECTION_KEY, LinearPlanState>

/** Tunable periodic summary cadence from the reference implementation. */
export interface PlanAndExecuteConfig {
  readonly summaryInterval: number
}

function summaryDue(state: LinearPlanState, interval: number): boolean {
  return state.plan !== null
    && state.actionSteps > 0
    && state.actionSteps % interval === 0
    && state.summarizedAt < state.actionSteps
}

const PLAN_AND_EXECUTE_PROMPT = 'Operate as a Plan-and-Execute agent. Follow the accepted roadmap mainly in order, use tool observations as evidence, and do not claim a step is complete without verification. Reuse known observations before making another call. Provide the final answer only when the roadmap\'s required outcomes are resolved.'

/** Render the current roadmap and execution requirement from replayed state. */
export function renderPlanAndExecuteContext(
  state: LinearPlanState,
  interval: number,
): string {
  if (state.plan === null) {
    return `Plan-and-Execute state: no roadmap has been accepted. Call ${SUBMIT_PLAN_TOOL} early with a 3-7 step ordered roadmap. You may first use task tools to inspect the workspace or gather facts needed to make the roadmap concrete. Each step must be specific and actionable, later steps must build on earlier results, and a verification step must appear near the end.`
  }
  const plan = state.plan.map((step, index) => `${index + 1}. ${step}`).join('\n')
  const summary = state.latestSummary === null ? '' : `\n\nLatest progress summary:\n${state.latestSummary}`
  const periodic = summaryDue(state, interval)
    ? `\n\nA progress review is due. Call ${RECORD_PROGRESS_TOOL} soon with a concise account of completed roadmap steps, unresolved steps, and the best next action.`
    : ''
  return `Plan-and-Execute state.\n\nRoadmap:\n${plan}${summary}${periodic}`
}

function protocolPhase(state: LinearPlanState, config: PlanAndExecuteConfig): HarnessProtocolPhase {
  if (state.plan === null) return {
    id: 'need-plan',
    context: renderPlanAndExecuteContext(state, config.summaryInterval),
    deniedTools: new Set([RECORD_PROGRESS_TOOL]),
    denial: `${RECORD_PROGRESS_TOOL} requires an accepted roadmap.`,
  }
  if (summaryDue(state, config.summaryInterval)) return {
    id: 'need-progress-review',
    context: renderPlanAndExecuteContext(state, config.summaryInterval),
    deniedTools: new Set([SUBMIT_PLAN_TOOL]),
  }
  return {
    id: 'working',
    context: renderPlanAndExecuteContext(state, config.summaryInterval),
    deniedTools: new Set([SUBMIT_PLAN_TOOL, RECORD_PROGRESS_TOOL]),
  }
}

function requireAgent(exec: ToolExecution, toolName: string): Agent {
  if (exec.agent === undefined) throw new Error(`${toolName} requires an owning DSH Agent`)
  return exec.agent
}

function submitPlanTool(): ToolDefinition {
  return {
    name: SUBMIT_PLAN_TOOL,
    description: 'Submit the initial ordered 3-7 step roadmap early, after any inspection needed to make it concrete.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        steps: { type: 'array', minItems: 3, maxItems: 7, items: { type: 'string' } },
      },
      required: ['steps'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { steps: { type: 'array', items: { type: 'string' } } },
        required: ['steps'],
      },
      render: (_args, value) => {
        const steps = stepsFromArguments(value)
        return [{ type: 'text', text: `Roadmap accepted with ${steps?.length ?? 0} ordered steps.` }]
      },
    },
    async execute(args, exec) {
      requireAgent(exec, SUBMIT_PLAN_TOOL)
      const steps = stepsFromArguments(args)
      if (steps === undefined) throw new Error('submit_plan requires 3-7 non-empty steps')
      return { steps }
    },
  }
}

function recordProgressTool(): ToolDefinition {
  return {
    name: RECORD_PROGRESS_TOOL,
    description: 'Record the periodic roadmap progress review when the Harness requests one.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { summary: { type: 'string', minLength: 1 } },
      required: ['summary'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
      render: () => [{ type: 'text', text: 'Progress review recorded; continue with the roadmap.' }],
    },
    async execute(args, exec) {
      requireAgent(exec, RECORD_PROGRESS_TOOL)
      const summary = summaryFromArguments(args)
      if (summary === undefined) throw new Error('record_progress requires a non-empty summary')
      return { summary }
    },
  }
}

/** Install linear planning, replayable progress state, and execution guards. */
export function applyPlanAndExecute(ctx: Context, config: PlanAndExecuteConfig): void {
  if (!Number.isSafeInteger(config.summaryInterval) || config.summaryInterval < 1) {
    throw new Error('plan-and-execute summaryInterval must be a positive safe integer')
  }
  ctx.sessionProjections.register(linearPlanProjectionDefinition)
  ctx.tools.register(submitPlanTool())
  ctx.tools.register(recordProgressTool())
  registerHarnessPrompt(ctx, { id: 'plan-and-execute', text: PLAN_AND_EXECUTE_PROMPT })
  installHarnessProtocol(ctx, {
    id: 'plan-and-execute',
    resolve: (agent) => {
      const state = ctx.sessionProjections.stateOf(agent.session, PLAN_AND_EXECUTE_PROJECTION_KEY)
      if (state === undefined) throw new Error('Plan-and-Execute projection is unavailable')
      return protocolPhase(state, config)
    },
  })
}
