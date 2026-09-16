import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { auxiliaryText } from '../runtime/auxiliary-llm.js'
import { assertValidDag, readyDagNodeIds } from '../runtime/dag.js'
import { contentText } from '../runtime/content.js'
import { registerHarnessPrompt } from '../runtime/prompt.js'
import { runIsolatedAgent } from '../runtime/subagent-ensemble.js'
import type { AgentTrajectory } from '../runtime/trajectory.js'

const RUN_TOOL = 'roma_solve'
const ROMA_SOURCE = 'harness-all-in-dsh:roma'

/** One dependency-aware subtask returned by the ROMA planner. */
export interface RomaPlannedTask {
  readonly id: string
  readonly goal: string
  readonly taskType: string
  readonly dependsOn: readonly string[]
}

/** A durable node in the recursive ROMA execution tree. */
export interface RomaNode {
  readonly id: string
  readonly parentId: string | null
  readonly depth: number
  readonly goal: string
  readonly taskType: string
  readonly decision: 'execute' | 'plan'
  readonly forcedExecution: boolean
  readonly decisionReason: string
  readonly plan: readonly RomaPlannedTask[]
  readonly children: readonly RomaNode[]
  readonly result: string
  readonly executorSessionId?: string
  readonly provider: string
  readonly model: string
}

/** ROMA recursion and child execution limits. */
export interface RomaConfig {
  readonly provider: string
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxChildren: number
  readonly maxParallel: number
  readonly auxiliaryMaxTokens: number
  readonly controllerReminderLimit: number
}

interface AtomizerDecision {
  readonly isAtomic: boolean
  readonly taskType: string
  readonly reason: string
}

interface NodeBudget { nextId: number; count: number }

function cleanJson(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

/** Parse the atomizer's strict decision response. */
export function parseRomaAtomizer(text: string): AtomizerDecision {
  const value = record(JSON.parse(cleanJson(text)) as unknown, 'ROMA atomizer response must be an object')
  if (typeof value.is_atomic !== 'boolean') throw new Error('ROMA atomizer is_atomic must be boolean')
  if (typeof value.task_type !== 'string' || value.task_type.trim().length === 0) throw new Error('ROMA atomizer task_type must be non-empty')
  if (typeof value.reason !== 'string' || value.reason.trim().length === 0) throw new Error('ROMA atomizer reason must be non-empty')
  return { isAtomic: value.is_atomic, taskType: value.task_type.trim(), reason: value.reason.trim() }
}

/** Parse and validate a bounded, acyclic ROMA subtask plan. */
export function parseRomaPlan(text: string, maximum: number): readonly RomaPlannedTask[] {
  const value = record(JSON.parse(cleanJson(text)) as unknown, 'ROMA planner response must be an object')
  if (!Array.isArray(value.subtasks) || value.subtasks.length < 1 || value.subtasks.length > maximum) {
    throw new Error(`ROMA planner must return 1-${maximum} subtasks`)
  }
  const tasks = value.subtasks.map((candidate, index): RomaPlannedTask => {
    const item = record(candidate, `ROMA subtask ${index} must be an object`)
    if (typeof item.id !== 'string' || item.id.trim().length === 0) throw new Error(`ROMA subtask ${index} id must be non-empty`)
    if (typeof item.goal !== 'string' || item.goal.trim().length === 0) throw new Error(`ROMA subtask ${index} goal must be non-empty`)
    if (typeof item.task_type !== 'string' || item.task_type.trim().length === 0) throw new Error(`ROMA subtask ${index} task_type must be non-empty`)
    if (!Array.isArray(item.depends_on) || !item.depends_on.every(dependency => typeof dependency === 'string' && dependency.trim().length > 0)) {
      throw new Error(`ROMA subtask ${index} depends_on must contain non-empty ids`)
    }
    return {
      id: item.id.trim(), goal: item.goal.trim(), taskType: item.task_type.trim(),
      dependsOn: item.depends_on.map(dependency => (dependency as string).trim()),
    }
  })
  assertValidDag(tasks)
  return tasks
}

function requireAgent(exec: ToolExecution): Agent {
  if (exec.agent === undefined) throw new Error(`${RUN_TOOL} requires an owning DSH Agent`)
  return exec.agent
}

function originalTask(agent: Agent): string {
  const task = agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
    ? [contentText(event.data.content)] : []).join('\n').trim()
  if (task.length === 0) throw new Error('ROMA requires a non-empty user task')
  return task
}

function finalAssistantText(trajectory: AgentTrajectory): string {
  const step = trajectory.steps.findLast(candidate => candidate.role === 'assistant' && candidate.content.trim().length > 0)
  if (step === undefined) throw new Error('ROMA executor child produced no final answer')
  return step.content.trim()
}

function dependencyContext(task: RomaPlannedTask, results: ReadonlyMap<string, RomaNode>): string {
  if (task.dependsOn.length === 0) return ''
  return task.dependsOn.map(id => {
    const dependency = results.get(id)
    if (dependency === undefined) throw new Error(`ROMA dependency ${id} has no result`)
    return `Dependency ${id} (${dependency.goal}):\n${dependency.result}`
  }).join('\n\n')
}

async function atomize(
  ctx: Context,
  parent: Agent,
  goal: string,
  context: string,
  config: RomaConfig,
  signal: AbortSignal,
): Promise<{ decision: AtomizerDecision; provider: string; model: string }> {
  const response = await auxiliaryText(
    ctx,
    parent,
    'You are ROMA\'s Atomizer. Decide whether one executor can directly complete the goal or recursive planning is necessary. Return only the requested JSON.',
    `Goal:\n${goal}\n\nDependency context:\n${context || '(none)'}\n\nAtomic means a single focused executor can complete the goal with its available tools. Return exactly {"is_atomic":boolean,"task_type":"RETRIEVE|THINK|WRITE|CODE|OTHER","reason":"short reason"}.`,
    config.auxiliaryMaxTokens,
    signal,
  )
  return { decision: parseRomaAtomizer(response.text), provider: response.provider, model: response.model }
}

async function plan(
  ctx: Context,
  parent: Agent,
  goal: string,
  context: string,
  config: RomaConfig,
  signal: AbortSignal,
): Promise<readonly RomaPlannedTask[]> {
  const response = await auxiliaryText(
    ctx,
    parent,
    'You are ROMA\'s Planner. Decompose a non-atomic goal into a minimal acyclic graph of precise subtasks. Return JSON only.',
    `Goal:\n${goal}\n\nDependency context:\n${context || '(none)'}\n\nReturn {"subtasks":[{"id":"0","goal":"imperative objective","task_type":"RETRIEVE|THINK|WRITE|CODE|OTHER","depends_on":[]}]} with 1-${config.maxChildren} subtasks. IDs must be unique. Dependencies may reference only listed IDs and must form a DAG. Prefer independent subtasks when possible; add dependencies only for real data flow. Do not execute the task.`,
    config.auxiliaryMaxTokens,
    signal,
  )
  return parseRomaPlan(response.text, config.maxChildren)
}

async function executeAtomic(
  ctx: Context,
  parent: Agent,
  nodeId: string,
  goal: string,
  taskType: string,
  dependencyInput: string,
  config: RomaConfig,
  signal: AbortSignal,
): Promise<{ result: string; sessionId: string }> {
  const trajectory = await runIsolatedAgent(ctx, {
    id: Number(nodeId.replace(/\D/gu, '')) || 1,
    label: `ROMA executor ${nodeId}`,
    parent,
    signal,
    provider: config.provider,
    deniedTools: [RUN_TOOL],
    persona: `You are a ROMA atomic executor for task type ${taskType}. Complete only the supplied atomic goal with available tools. Treat dependency outputs as context, verify tool observations, and return a standalone result. Do not decompose or delegate.`,
    prompt: `Atomic goal:\n${goal}\n\nDependency outputs:\n${dependencyInput || '(none)'}`,
  })
  return { result: finalAssistantText(trajectory), sessionId: trajectory.sessionId }
}

async function aggregate(
  ctx: Context,
  parent: Agent,
  goal: string,
  tasks: readonly RomaPlannedTask[],
  results: ReadonlyMap<string, RomaNode>,
  config: RomaConfig,
  signal: AbortSignal,
): Promise<{ result: string; provider: string; model: string }> {
  const children = tasks.map(task => ({
    id: task.id, goal: task.goal, task_type: task.taskType, depends_on: task.dependsOn,
    result: results.get(task.id)?.result ?? '',
  }))
  const response = await auxiliaryText(
    ctx,
    parent,
    'You are ROMA\'s Aggregator. Synthesize completed child results into the answer to the parent goal. Do not re-plan or invent evidence.',
    `Original goal:\n${goal}\n\nCompleted subtasks:\n${JSON.stringify(children)}\n\nReturn a complete standalone answer to the original goal. Resolve overlaps and preserve concrete evidence.`,
    config.auxiliaryMaxTokens,
    signal,
  )
  return { result: response.text, provider: response.provider, model: response.model }
}

async function inBatches<T, R>(items: readonly T[], maximum: number, run: (item: T) => Promise<R>): Promise<readonly R[]> {
  const output: R[] = []
  for (let index = 0; index < items.length; index += maximum) {
    output.push(...await Promise.all(items.slice(index, index + maximum).map(run)))
  }
  return output
}

async function solveNode(
  ctx: Context,
  parent: Agent,
  goal: string,
  dependencyInput: string,
  depth: number,
  parentId: string | null,
  config: RomaConfig,
  budget: NodeBudget,
  signal: AbortSignal,
): Promise<RomaNode> {
  if (budget.count >= config.maxNodes) throw new Error(`ROMA exceeded its ${config.maxNodes}-node budget`)
  const id = `node-${budget.nextId}`
  budget.nextId += 1
  budget.count += 1
  const forcedExecution = depth >= config.maxDepth
  const atomized = forcedExecution
    ? { decision: { isAtomic: true, taskType: 'OTHER', reason: `maximum depth ${config.maxDepth} reached` }, provider: '', model: '' }
    : await atomize(ctx, parent, goal, dependencyInput, config, signal)
  if (atomized.decision.isAtomic) {
    const executed = await executeAtomic(ctx, parent, id, goal, atomized.decision.taskType, dependencyInput, config, signal)
    return {
      id, parentId, depth, goal, taskType: atomized.decision.taskType, decision: 'execute', forcedExecution,
      decisionReason: atomized.decision.reason, plan: [], children: [], result: executed.result,
      executorSessionId: executed.sessionId, provider: atomized.provider, model: atomized.model,
    }
  }
  const subtasks = await plan(ctx, parent, goal, dependencyInput, config, signal)
  if (budget.count + subtasks.length > config.maxNodes) throw new Error(`ROMA plan would exceed its ${config.maxNodes}-node budget`)
  const pending = new Map(subtasks.map(task => [task.id, task]))
  const completed = new Map<string, RomaNode>()
  while (pending.size > 0) {
    const readyIds = readyDagNodeIds(subtasks, new Set(completed.keys())).filter(taskId => pending.has(taskId))
    if (readyIds.length === 0) throw new Error('ROMA planner produced an unschedulable dependency graph')
    const ready = readyIds.map(taskId => pending.get(taskId) as RomaPlannedTask)
    const nodes = await inBatches(ready, config.maxParallel, async task => await solveNode(
      ctx, parent, task.goal, dependencyContext(task, completed), depth + 1, id, config, budget, signal,
    ))
    ready.forEach((task, index) => {
      pending.delete(task.id)
      completed.set(task.id, nodes[index] as RomaNode)
    })
  }
  const aggregated = await aggregate(ctx, parent, goal, subtasks, completed, config, signal)
  return {
    id, parentId, depth, goal, taskType: atomized.decision.taskType, decision: 'plan', forcedExecution,
    decisionReason: atomized.decision.reason, plan: subtasks,
    children: subtasks.map(task => completed.get(task.id) as RomaNode), result: aggregated.result,
    provider: aggregated.provider, model: aggregated.model,
  }
}

function runTool(ctx: Context, config: RomaConfig, completed: WeakSet<Agent>): ToolDefinition {
  return {
    name: RUN_TOOL,
    description: 'Run ROMA recursive atomize-plan-execute-aggregate orchestration and return its final answer plus durable task tree.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'object' && value !== null && 'answer' in value ? String(value.answer) : '' }],
      presentationMeta: (_args, value) => value,
    },
    async execute(_args, exec) {
      const parent = requireAgent(exec)
      if (completed.has(parent)) throw new Error('ROMA has already completed this task')
      const budget: NodeBudget = { nextId: 1, count: 0 }
      const root = await solveNode(ctx, parent, originalTask(parent), '', 0, null, config, budget, exec.signal)
      completed.add(parent)
      exec.concludeTurn()
      return { answer: root.result, nodeCount: budget.count, root }
    },
  }
}

/** Install the ROMA recursive subagent controller. */
export function applyRoma(ctx: Context, config: RomaConfig): void {
  if (config.provider.trim().length === 0) throw new Error('roma provider must be non-empty')
  for (const [name, value, minimum] of [
    ['maxDepth', config.maxDepth, 0], ['maxNodes', config.maxNodes, 1], ['maxChildren', config.maxChildren, 1],
    ['maxParallel', config.maxParallel, 1], ['auxiliaryMaxTokens', config.auxiliaryMaxTokens, 1],
    ['controllerReminderLimit', config.controllerReminderLimit, 0],
  ] as const) if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`roma ${name} must be a safe integer >= ${minimum}`)
  const completed = new WeakSet<Agent>()
  const reminders = new WeakMap<Agent, number>()
  ctx.tools.register(runTool(ctx, config, completed))
  ctx.tools.guard(exec => {
    const agent = exec.agent
    if (agent === undefined || agent.session.header.parentSession !== undefined) return undefined
    return exec.name === RUN_TOOL ? undefined : `ROMA coordinator must call ${RUN_TOOL}; atomic task tools belong to executor children.`
  })
  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (agent.session.header.parentSession !== undefined || completed.has(agent)) return
    const count = reminders.get(agent) ?? 0
    if (count >= config.controllerReminderLimit) return
    reminders.set(agent, count + 1)
    agent.steer(createUserMessage({
      source: { kind: 'plugin', plugin: ROMA_SOURCE },
      content: [{ type: 'text', text: `Call ${RUN_TOOL} now. It owns atomization, recursive DAG execution, and aggregation.` }],
    }))
  })
  registerHarnessPrompt(ctx, {
    id: 'roma',
    text: ({ agent }) => agent?.session.header.parentSession === undefined
      ? `Operate only as the ROMA coordinator. Immediately call ${RUN_TOOL} with an empty object. Do not solve the task yourself or call ordinary task tools; the composite tool recursively atomizes, plans dependency-aware subtasks, runs atomic executors, aggregates upward, and concludes the turn.`
      : '',
  })
}
