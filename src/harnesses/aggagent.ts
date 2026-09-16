import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { contentText } from '../runtime/content.js'
import { registerHarnessPrompt } from '../runtime/prompt.js'
import {
  formatTrajectoryMetadata,
  searchTrajectory,
  trajectorySegment,
  trajectorySolutions,
} from '../runtime/trajectory.js'
import type { AgentTrajectory } from '../runtime/trajectory.js'
import { runIsolatedAgent } from '../runtime/subagent-ensemble.js'

const GET_SOLUTION_TOOL = 'aggagent_get_solution'
const SEARCH_TOOL = 'aggagent_search_trajectory'
const GET_SEGMENT_TOOL = 'aggagent_get_segment'
const FINISH_TOOL = 'aggagent_finish'
const AGGREGATION_TOOLS = [GET_SOLUTION_TOOL, SEARCH_TOOL, GET_SEGMENT_TOOL, FINISH_TOOL] as const
const AGGAGENT_SOURCE = 'harness-all-in-dsh:aggagent'

interface AggregationState {
  readonly trajectories: readonly AgentTrajectory[]
  readonly inspectedSolutions: Set<number>
  verifiedTrajectory: boolean
}

/** AggAgent rollout count and child-provider selection. */
export interface AggAgentConfig {
  readonly rolloutCount: number
  readonly provider: string
}

function requireAgent(exec: ToolExecution, name: string): Agent {
  if (exec.agent === undefined) throw new Error(`${name} requires an owning DSH Agent`)
  return exec.agent
}

function trajectory(state: AggregationState, id: number): AgentTrajectory {
  const found = state.trajectories.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`trajectoryId must be 1-${state.trajectories.length}`)
  return found
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('tool input must be an object')
  return value as Record<string, unknown>
}

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`)
  return value as number
}

async function runRollout(
  ctx: Context,
  parent: Agent,
  task: string,
  id: number,
  count: number,
  provider: string,
  signal: AbortSignal,
): Promise<AgentTrajectory> {
  return await runIsolatedAgent(ctx, {
    id,
    label: `AggAgent rollout ${id}`,
    parent,
    signal,
    provider,
    deniedTools: AGGREGATION_TOOLS,
    persona: 'Operate as an independent ReAct rollout. Use available task tools to gather evidence, inspect every observation, and return your best standalone final answer. Do not delegate or discuss aggregation.',
    prompt: `Independently solve the following task. You are rollout ${id} of ${count}; do not coordinate with other rollouts.\n\n${task}`,
  })
}

function hasDisagreement(state: AggregationState): boolean {
  const normalized = trajectorySolutions(state.trajectories).map(entry => entry.content.trim()).filter(Boolean)
  return new Set(normalized).size > 1
}

function renderPrompt(agent: Agent | undefined, states: WeakMap<Agent, AggregationState>, config: AggAgentConfig): string {
  if (agent?.session.header.parentSession !== undefined) return ''
  const count = agent === undefined ? config.rolloutCount : states.get(agent)?.trajectories.length ?? config.rolloutCount
  return `You are the AggAgent aggregation agent. ${count} independent candidate rollouts are generated before your first request. You do not have ground truth.\n\nRequired procedure:\n1. Call ${GET_SOLUTION_TOOL} to inspect every final solution.\n2. Verify key claims against raw trajectory evidence with ${SEARCH_TOOL} and ${GET_SEGMENT_TOOL}. Tool observations are ground truth; rollout reasoning is not. Count evidence, not trajectories, and do not use majority agreement as proof.\n3. Resolve conflicts and call ${FINISH_TOOL}. The solution must be standalone and must not mention trajectories, agents, or aggregation.\n\nDo not call ordinary task tools in the coordinator.`
}

function hasCatalogue(agent: Agent): boolean {
  return agent.session.snapshotEvents().some(event => event.type === 'user/message'
    && event.data.source.kind === 'plugin' && event.data.source.plugin === AGGAGENT_SOURCE)
}

function catalogueMessage(trajectories: readonly AgentTrajectory[]) {
  return createUserMessage({
    source: { kind: 'plugin' as const, plugin: AGGAGENT_SOURCE },
    content: [{ type: 'text' as const, text: `AggAgent rollout generation completed.\n\n${formatTrajectoryMetadata(trajectories)}\n\nValid trajectoryId values are 1-${trajectories.length}. Begin by retrieving every final solution.` }],
  })
}

function getSolutionTool(states: WeakMap<Agent, AggregationState>): ToolDefinition {
  return {
    name: GET_SOLUTION_TOOL,
    description: 'Retrieve the final content from one or all candidate trajectories.',
    parameters: { type: 'object', additionalProperties: false, properties: { trajectoryId: { type: 'integer', minimum: 1 } }, required: [] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const state = states.get(requireAgent(exec, GET_SOLUTION_TOOL))
      if (state === undefined) throw new Error('generate AggAgent rollouts first')
      const value = inputRecord(args).trajectoryId
      const id = value === undefined ? undefined : integer(value, 'trajectoryId')
      if (id === undefined) {
        for (const item of state.trajectories) state.inspectedSolutions.add(item.id)
      } else {
        state.inspectedSolutions.add(id)
      }
      return { solutions: trajectorySolutions(state.trajectories, id) }
    },
  }
}

function searchTool(states: WeakMap<Agent, AggregationState>): ToolDefinition {
  return {
    name: SEARCH_TOOL,
    description: 'Search one trajectory by ROUGE-L recall. Filter role=tool to verify environment observations.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      trajectoryId: { type: 'integer', minimum: 1 }, query: { type: 'string', minLength: 1 },
      role: { type: 'string', enum: ['tool', 'assistant'] }, k: { type: 'integer', minimum: 1, maximum: 10 },
    }, required: ['trajectoryId', 'query'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const state = states.get(requireAgent(exec, SEARCH_TOOL))
      if (state === undefined) throw new Error('generate AggAgent rollouts first')
      const input = inputRecord(args)
      const id = integer(input.trajectoryId, 'trajectoryId')
      if (typeof input.query !== 'string' || input.query.trim().length === 0) throw new Error('query must be non-empty')
      if (input.role !== undefined && input.role !== 'tool' && input.role !== 'assistant') throw new Error('role must be tool or assistant')
      const k = input.k === undefined ? 5 : integer(input.k, 'k')
      if (k < 1 || k > 10) throw new Error('k must be 1-10')
      state.verifiedTrajectory = true
      return { matches: searchTrajectory(trajectory(state, id), input.query, input.role, k) }
    },
  }
}

function getSegmentTool(states: WeakMap<Agent, AggregationState>): ToolDefinition {
  return {
    name: GET_SEGMENT_TOOL,
    description: 'Read a contiguous range of at most five full steps from one trajectory.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      trajectoryId: { type: 'integer', minimum: 1 }, startStep: { type: 'integer', minimum: 1 }, endStep: { type: 'integer', minimum: 1 },
    }, required: ['trajectoryId', 'startStep', 'endStep'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const state = states.get(requireAgent(exec, GET_SEGMENT_TOOL))
      if (state === undefined) throw new Error('generate AggAgent rollouts first')
      const input = inputRecord(args)
      const id = integer(input.trajectoryId, 'trajectoryId')
      const start = integer(input.startStep, 'startStep')
      const end = integer(input.endStep, 'endStep')
      state.verifiedTrajectory = true
      return { segment: trajectorySegment(trajectory(state, id), start, end) }
    },
  }
}

function finishTool(states: WeakMap<Agent, AggregationState>): ToolDefinition {
  return {
    name: FINISH_TOOL,
    description: 'Submit the verified standalone AggAgent synthesis and concise aggregation rationale.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      solution: { type: 'string', minLength: 1 }, reason: { type: 'string', minLength: 1 },
    }, required: ['solution', 'reason'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => {
      const solution = typeof value === 'object' && value !== null && 'solution' in value ? String(value.solution) : ''
      return [{ type: 'text', text: solution }]
    } },
    async execute(args, exec) {
      const state = states.get(requireAgent(exec, FINISH_TOOL))
      if (state === undefined) throw new Error('generate AggAgent rollouts first')
      if (state.inspectedSolutions.size !== state.trajectories.length) throw new Error(`inspect every final solution with ${GET_SOLUTION_TOOL} before finishing`)
      if (hasDisagreement(state) && !state.verifiedTrajectory) throw new Error(`candidate solutions disagree; verify raw evidence with ${SEARCH_TOOL} or ${GET_SEGMENT_TOOL}`)
      const input = inputRecord(args)
      if (typeof input.solution !== 'string' || typeof input.reason !== 'string' || input.reason.trim().length === 0) throw new Error('solution and reason must be non-empty strings')
      const match = input.solution.match(/^\s*<explanation>([\s\S]+)<\/explanation>\s*<answer>([\s\S]+)<\/answer>\s*$/u)
      if (match?.[1]?.trim().length === 0 || match?.[2]?.trim().length === 0 || match === null) {
        throw new Error('solution must contain non-empty <explanation>...</explanation><answer>...</answer> sections')
      }
      exec.concludeTurn()
      return { solution: input.solution, reason: input.reason }
    },
  }
}

/** Install isolated rollout generation and evidence-first agentic aggregation. */
export function applyAggAgent(ctx: Context, config: AggAgentConfig): void {
  if (!Number.isSafeInteger(config.rolloutCount) || config.rolloutCount < 2) throw new Error('aggagent rolloutCount must be a safe integer of at least 2')
  if (config.provider.trim().length === 0) throw new Error('aggagent provider must be non-empty')
  const states = new WeakMap<Agent, AggregationState>()
  ctx.tools.register(getSolutionTool(states))
  ctx.tools.register(searchTool(states))
  ctx.tools.register(getSegmentTool(states))
  ctx.tools.register(finishTool(states))
  ctx.tools.guard(exec => {
    const agent = exec.agent
    if (agent === undefined || agent.session.header.parentSession !== undefined) return undefined
    const state = states.get(agent)
    if (state === undefined) return 'AggAgent rollout generation has not completed.'
    return exec.name === GET_SOLUTION_TOOL || exec.name === SEARCH_TOOL || exec.name === GET_SEGMENT_TOOL || exec.name === FINISH_TOOL
      ? undefined
      : 'AggAgent aggregation may use only trajectory inspection tools and finish.'
  })
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    if (agent.session.header.parentSession !== undefined) return await next()
    let state = states.get(agent)
    if (state === undefined) {
      const task = messages.map(message => contentText(message.content)).join('\n').trim()
      if (task.length === 0) throw new Error('AggAgent requires a non-empty user task')
      const settled = await Promise.allSettled(Array.from({ length: config.rolloutCount }, (_, index) =>
        runRollout(ctx, agent, task, index + 1, config.rolloutCount, config.provider, signal)))
      const failures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
      if (failures.length > 0) throw new AggregateError(failures.map(entry => entry.reason), `${failures.length} AggAgent rollout(s) failed`)
      const trajectories = settled.map(entry => (entry as PromiseFulfilledResult<AgentTrajectory>).value)
      state = { trajectories, inspectedSolutions: new Set(), verifiedTrajectory: false }
      states.set(agent, state)
    }
    const decision = await next()
    if (decision.kind === 'reject' || hasCatalogue(agent)) return decision
    return { ...decision, messages: [...decision.messages, catalogueMessage(state.trajectories)] }
  })
  registerHarnessPrompt(ctx, { id: 'aggagent', text: ({ agent }) => renderPrompt(agent, states, config) })
}
