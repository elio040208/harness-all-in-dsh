import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { registerHarnessContext, registerHarnessPrompt } from '../runtime/prompt.js'
import { runIsolatedAgent } from '../runtime/subagent-ensemble.js'
import { trajectoryFinalAnswer, truncateWords } from '../runtime/trajectory.js'
import type { AgentTrajectory } from '../runtime/trajectory.js'

const DELEGATE_TOOL = 'aorchestra_delegate'
const COMPLETE_TOOL = 'aorchestra_complete'
const AORCHESTRA_SOURCE = 'harness-all-in-dsh:aorchestra'

/** The runtime-configured instruction, context, tools, and model tuple. */
export interface AOrchestraTuple {
  readonly instruction: string
  readonly context: string
  readonly tools: readonly string[]
  readonly provider: string
  readonly model: string
}

/** One completed dynamic AOrchestra delegation. */
export interface AOrchestraDelegation {
  readonly attempt: number
  readonly tuple: AOrchestraTuple
  readonly result: string
  readonly traceSummary: readonly string[]
  readonly childSessionId: string
  readonly stopReason: string
  readonly stepsTaken: number
}

/** AOrchestra model, delegation, and coordinator retry limits. */
export interface AOrchestraConfig {
  readonly subagentProvider: string
  readonly modelProvider: string
  readonly models: readonly string[]
  readonly maxDelegations: number
  readonly controllerReminderLimit: number
}

interface AOrchestraState { readonly delegations: AOrchestraDelegation[]; completed: boolean }
interface SearchableTool { readonly name: string; readonly description?: string }

function requireAgent(exec: ToolExecution, tool: string): Agent {
  if (exec.agent === undefined) throw new Error(`${tool} requires an owning DSH Agent`)
  return exec.agent
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('tool input must be an object')
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

/** List ordinary task tools that AOrchestra may assign to a child. */
export function aorchestraToolCatalogue(agent: Agent): readonly SearchableTool[] {
  return ((agent.session.requestHeader()?.tools ?? []) as readonly SearchableTool[])
    .filter(tool => tool.name !== DELEGATE_TOOL && tool.name !== COMPLETE_TOOL)
}

function selectedTools(value: unknown, catalogue: readonly SearchableTool[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(item => typeof item === 'string' && item.trim().length > 0)) {
    throw new Error('tools must be a non-empty array of tool names')
  }
  const names = [...new Set(value.map(item => (item as string).trim()))]
  const available = new Set(catalogue.map(tool => tool.name))
  const unknown = names.filter(name => !available.has(name))
  if (unknown.length > 0) throw new Error(`unknown or unavailable child tools: ${unknown.join(', ')}`)
  return names
}

function selectedProvider(parent: Agent, configured: string): string {
  const provider = configured.trim() || parent.session.requestHeader()?.config.provider || parent.options.provider
  if (provider === undefined || provider.trim().length === 0) throw new Error('AOrchestra has no provider route for the selected child model')
  return provider
}

function finalResult(trajectory: AgentTrajectory): string {
  const answer = trajectoryFinalAnswer(trajectory)
  if (answer.length === 0) throw new Error('AOrchestra child produced no final answer')
  return answer
}

/** Build the bounded trace summary returned to the main orchestrator. */
export function aorchestraTraceSummary(trajectory: AgentTrajectory): readonly string[] {
  const observations = trajectory.steps.filter(step => step.role === 'tool').slice(-6).map(step =>
    `${step.toolName ?? 'tool'}: ${truncateWords(step.content, 120)}`)
  return observations.length === 0 ? ['No tool observations were produced.'] : observations
}

function stateOf(states: WeakMap<Agent, AOrchestraState>, agent: Agent): AOrchestraState {
  let state = states.get(agent)
  if (state === undefined) {
    state = { delegations: [], completed: false }
    states.set(agent, state)
  }
  return state
}

function delegateTool(ctx: Context, config: AOrchestraConfig, states: WeakMap<Agent, AOrchestraState>): ToolDefinition {
  return {
    name: DELEGATE_TOOL,
    description: 'Create and run one fresh AOrchestra child using an explicit <instruction, context, tools, model> tuple.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      instruction: { type: 'string', minLength: 1 },
      context: { type: 'string' },
      tools: { type: 'array', items: { type: 'string' }, minItems: 1 },
      model: { type: 'string', enum: [...config.models] },
    }, required: ['instruction', 'context', 'tools', 'model'] },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => value,
    },
    async execute(args, exec) {
      const parent = requireAgent(exec, DELEGATE_TOOL)
      const state = stateOf(states, parent)
      if (state.completed) throw new Error('AOrchestra has already completed this task')
      if (state.delegations.length >= config.maxDelegations) throw new Error(`AOrchestra allows at most ${config.maxDelegations} delegations`)
      const input = inputRecord(args)
      const instruction = nonEmptyString(input.instruction, 'instruction')
      const context = typeof input.context === 'string' ? input.context.trim() : (() => { throw new Error('context must be a string') })()
      const model = nonEmptyString(input.model, 'model')
      if (!config.models.includes(model)) throw new Error(`model must be one of: ${config.models.join(', ')}`)
      const tools = selectedTools(input.tools, aorchestraToolCatalogue(parent))
      const provider = selectedProvider(parent, config.modelProvider)
      const tuple: AOrchestraTuple = { instruction, context, tools, provider, model }
      const attempt = state.delegations.length + 1
      const trajectory = await runIsolatedAgent(ctx, {
        id: attempt,
        label: `AOrchestra delegation ${attempt}`,
        parent,
        signal: exec.signal,
        provider: config.subagentProvider,
        deniedTools: [],
        allowedTools: tools,
        agentOptions: { provider, model },
        persona: 'You are a dynamically configured AOrchestra sub-agent. Follow only the delegated instruction, use only your assigned tools, treat supplied context as potentially incomplete prior findings, verify observations, and return a standalone result. Do not delegate.',
        prompt: `Instruction:\n${instruction}\n\nCurated context:\n${context || '(none)'}\n\nAssigned tools:\n${tools.join(', ')}`,
      })
      const delegation: AOrchestraDelegation = {
        attempt, tuple, result: finalResult(trajectory), traceSummary: aorchestraTraceSummary(trajectory),
        childSessionId: trajectory.sessionId, stopReason: trajectory.stopReason, stepsTaken: trajectory.steps.length,
      }
      state.delegations.push(delegation)
      return delegation
    },
  }
}

function completeTool(states: WeakMap<Agent, AOrchestraState>): ToolDefinition {
  return {
    name: COMPLETE_TOOL,
    description: 'Complete AOrchestra with a standalone answer after reviewing all dynamic delegation results.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      answer: { type: 'string', minLength: 1 }, reasoning: { type: 'string', minLength: 1 },
    }, required: ['answer', 'reasoning'] },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'object' && value !== null && 'answer' in value ? String(value.answer) : '' }],
      presentationMeta: (_args, value) => value,
    },
    async execute(args, exec) {
      const parent = requireAgent(exec, COMPLETE_TOOL)
      const state = stateOf(states, parent)
      if (state.delegations.length === 0) throw new Error(`AOrchestra must call ${DELEGATE_TOOL} before completing`)
      if (state.completed) throw new Error('AOrchestra has already completed this task')
      const input = inputRecord(args)
      const answer = nonEmptyString(input.answer, 'answer')
      const reasoning = nonEmptyString(input.reasoning, 'reasoning')
      state.completed = true
      exec.concludeTurn()
      return { answer, reasoning, delegations: state.delegations }
    },
  }
}

function toolCatalogueText(agent: Agent | undefined): string {
  if (agent === undefined) return '(available task tools are supplied at runtime)'
  const tools = aorchestraToolCatalogue(agent)
  return tools.length === 0 ? '(none)' : tools.map(tool => `- ${tool.name}: ${(tool.description ?? '').slice(0, 180)}`).join('\n')
}

function coordinatorPrompt(agent: Agent | undefined): string {
  if (agent?.session.header.parentSession !== undefined) return ''
  return `You are the AOrchestra MainAgent. Solve the task through dynamic sub-agents, not with ordinary tools yourself. For each remaining subtask call ${DELEGATE_TOOL} with the complete four-tuple: a specific instruction I, only relevant prior context C, the smallest sufficient tool-name whitelist T, and one allowed model M. Review every returned result and trace summary. Delegate only remaining work; do not repeat completed work. When evidence is sufficient, call ${COMPLETE_TOOL} with a standalone answer.`
}

/** Render the current delegation budget and child capability catalogue. */
export function renderAOrchestraContext(attempts: number, config: AOrchestraConfig, tools: string): string {
  return `AOrchestra state.\n\nDelegation budget: ${attempts}/${config.maxDelegations} used.\nAllowed models: ${config.models.join(', ')}\nAvailable child tools:\n${tools}`
}

/** Install AOrchestra's iterative runtime-configured subagent controller. */
export function applyAOrchestra(ctx: Context, config: AOrchestraConfig): void {
  if (config.subagentProvider.trim().length === 0) throw new Error('aorchestra subagentProvider must be non-empty')
  if (config.models.length === 0 || config.models.some(model => model.trim().length === 0) || new Set(config.models).size !== config.models.length) {
    throw new Error('aorchestra models must be a non-empty unique list')
  }
  if (!Number.isSafeInteger(config.maxDelegations) || config.maxDelegations < 1) throw new Error('aorchestra maxDelegations must be a positive safe integer')
  if (!Number.isSafeInteger(config.controllerReminderLimit) || config.controllerReminderLimit < 0) throw new Error('aorchestra controllerReminderLimit must be a non-negative safe integer')
  const states = new WeakMap<Agent, AOrchestraState>()
  const reminders = new WeakMap<Agent, number>()
  ctx.tools.register(delegateTool(ctx, config, states))
  ctx.tools.register(completeTool(states))
  ctx.tools.guard(exec => {
    const agent = exec.agent
    if (agent === undefined || agent.session.header.parentSession !== undefined) return undefined
    return exec.name === DELEGATE_TOOL || exec.name === COMPLETE_TOOL
      ? undefined : `AOrchestra MainAgent may use only ${DELEGATE_TOOL} and ${COMPLETE_TOOL}.`
  })
  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (agent.session.header.parentSession !== undefined || states.get(agent)?.completed === true) return
    const count = reminders.get(agent) ?? 0
    if (count >= config.controllerReminderLimit) return
    reminders.set(agent, count + 1)
    agent.steer(createUserMessage({
      source: { kind: 'plugin', plugin: AORCHESTRA_SOURCE },
      content: [{ type: 'text', text: `Do not answer directly. Call ${DELEGATE_TOOL} for remaining work or ${COMPLETE_TOOL} if prior delegations suffice.` }],
    }))
  })
  registerHarnessPrompt(ctx, { id: 'aorchestra', text: ({ agent }) => coordinatorPrompt(agent) })
  registerHarnessContext(ctx, {
    id: 'aorchestra',
    text: ({ agent }) => {
      if (agent === undefined || agent.session.header.parentSession !== undefined) return ''
      return renderAOrchestraContext(states.get(agent)?.delegations.length ?? 0, config, toolCatalogueText(agent))
    },
  })
}
