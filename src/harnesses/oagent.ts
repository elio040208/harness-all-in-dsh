import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { auxiliaryText } from '../runtime/auxiliary-llm.js'
import { contentText } from '../runtime/content.js'
import { registerHarnessPrompt } from '../runtime/prompt.js'
import { installHarnessProtocol } from '../runtime/protocol.js'
import { runIsolatedAgent } from '../runtime/subagent-ensemble.js'
import { trajectorySolutions, truncateWords } from '../runtime/trajectory.js'
import type { AgentTrajectory } from '../runtime/trajectory.js'

const RUN_TOOL = 'oagent_run_ensemble'
const OAGENT_SOURCE = 'harness-all-in-dsh:oagent'

/** OAgent expert counts, child provider, and critic output budget. */
export interface OAgentConfig {
  readonly peWorkers: number
  readonly reactWorkers: number
  readonly provider: string
  readonly criticMaxTokens: number
  readonly controllerReminderLimit: number
}

/** Compact expert evidence supplied to the OAgent critic and persisted in the parent result. */
export interface OAgentExpertDigest {
  readonly name: string
  readonly answer: string
  readonly evidence: readonly { readonly tool: string; readonly observation: string }[]
  readonly sessionId: string
  readonly stopReason: string
}

/** Parsed critic selection with its final user-facing answer. */
export interface OAgentCriticVerdict {
  readonly selectedExpert: string
  readonly answer: string
}

function requireAgent(exec: ToolExecution): Agent {
  if (exec.agent === undefined) throw new Error(`${RUN_TOOL} requires an owning DSH Agent`)
  return exec.agent
}

/** Build the bounded answer-and-observation view used by the fixed OAgent critic. */
export function oagentExpertDigest(name: string, trajectory: AgentTrajectory): OAgentExpertDigest {
  const answer = trajectorySolutions([trajectory])[0]?.content ?? 'No answer produced'
  const evidence = trajectory.steps.filter(step => step.role === 'tool').slice(0, 5).map(step => ({
    tool: step.toolName ?? 'unknown',
    observation: truncateWords(step.content, 500),
  }))
  return {
    name,
    answer: truncateWords(answer, 1000),
    evidence,
    sessionId: trajectory.sessionId,
    stopReason: trajectory.stopReason,
  }
}

function cleanJson(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
}

/** Validate the OAgent critic's exact JSON verdict and expert reference. */
export function parseOAgentCriticVerdict(text: string, experts: readonly OAgentExpertDigest[]): OAgentCriticVerdict {
  const value: unknown = JSON.parse(cleanJson(text))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('OAgent critic verdict must be an object')
  const record = value as Record<string, unknown>
  if (typeof record.answer !== 'string' || record.answer.trim().length === 0) throw new Error('OAgent critic answer must be non-empty')
  if (typeof record.selected_expert !== 'string' || !experts.some(expert => expert.name === record.selected_expert)) {
    throw new Error('OAgent critic selected_expert must name an existing expert exactly')
  }
  return { selectedExpert: record.selected_expert, answer: record.answer.trim() }
}

function criticPrompt(task: string, experts: readonly OAgentExpertDigest[]): string {
  const sections = experts.map(expert => {
    const evidence = expert.evidence.length === 0
      ? '  (No tool evidence collected)'
      : expert.evidence.map(item => `  Tool(${item.tool}): ${item.observation}`).join('\n')
    return `### ${expert.name}\n**Answer:** ${expert.answer}\n**Evidence:**\n${evidence}`
  }).join('\n\n')
  return `Task:\n${task}\n\nExpert answers:\n${sections}\n\nEvaluate every answer for compliance, concrete tool evidence, logic, and specificity. Majority agreement is useful only when well evidenced; prefer a minority answer with stronger observations. You may synthesize the best answer, but selected_expert must name the single expert whose evidence you relied on most. Return only JSON with exactly {"selected_expert":"exact expert name","answer":"final answer for the user"}.`
}

function workerSpecs(config: OAgentConfig): readonly { readonly name: string; readonly persona: string }[] {
  const workers: { name: string; persona: string }[] = []
  for (let index = 1; index <= config.peWorkers; index += 1) workers.push({
    name: `PE-Worker-${index}`,
    persona: 'You are a Plan-and-Execute expert. First form a detailed roadmap, then execute it step by step with available tools, verifying each result and trying an alternative after failures. Return a complete standalone final answer when every step is resolved. Do not delegate.',
  })
  for (let index = 1; index <= config.reactWorkers; index += 1) workers.push({
    name: `ReAct-Worker-${index}`,
    persona: 'You are a ReAct expert. Adaptively alternate reasoning, tool action, observation, and reflection. Try a different angle when one path fails, and return a complete standalone final answer once observations support it. Do not delegate.',
  })
  return workers
}

async function runExperts(
  ctx: Context,
  parent: Agent,
  task: string,
  config: OAgentConfig,
  signal: AbortSignal,
): Promise<readonly OAgentExpertDigest[]> {
  const digests: OAgentExpertDigest[] = []
  const specs = workerSpecs(config)
  for (const [index, spec] of specs.entries()) {
    const trajectory = await runIsolatedAgent(ctx, {
      id: index + 1,
      label: spec.name,
      prompt: `Solve this task independently as ${spec.name}.\n\n${task}`,
      persona: spec.persona,
      provider: config.provider,
      deniedTools: [RUN_TOOL],
      parent,
      signal,
    })
    digests.push(oagentExpertDigest(spec.name, trajectory))
  }
  return digests
}

function runTool(ctx: Context, config: OAgentConfig, completed: WeakSet<Agent>): ToolDefinition {
  return {
    name: RUN_TOOL,
    description: 'Run the complete OAgent ensemble: heterogeneous isolated experts followed by the evidence-aware critic. This is the only coordinator action.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => {
      const answer = typeof value === 'object' && value !== null && 'answer' in value ? String(value.answer) : ''
      return [{ type: 'text', text: answer }]
    }, presentationMeta: (_args, value) => value },
    async execute(_args, exec) {
      const parent = requireAgent(exec)
      if (completed.has(parent)) throw new Error('OAgent ensemble has already completed')
      const task = parent.session.snapshotEvents().flatMap(event =>
        event.type === 'user/message' && event.data.source.kind === 'user' ? [contentText(event.data.content)] : []).join('\n').trim()
      if (task.length === 0) throw new Error('OAgent requires a non-empty user task')
      const experts = await runExperts(ctx, parent, task, config, exec.signal)
      const fallback = experts[0]
      if (fallback === undefined) throw new Error('OAgent produced no expert results')
      let verdict: OAgentCriticVerdict = { selectedExpert: fallback.name, answer: fallback.answer }
      let critic: { provider: string; model: string; rawVerdict: string; error?: string }
      try {
        const result = await auxiliaryText(
          ctx,
          parent,
          'You are the OAgent Expert Judge. Evaluate the supplied expert answers and their tool observations. Return only the requested JSON object.',
          criticPrompt(task, experts),
          config.criticMaxTokens,
          exec.signal,
        )
        critic = { provider: result.provider, model: result.model, rawVerdict: result.text }
        try {
          verdict = parseOAgentCriticVerdict(result.text, experts)
        } catch (error: unknown) {
          critic = { ...critic, error: String(error) }
        }
      } catch (error: unknown) {
        critic = { provider: '', model: '', rawVerdict: '', error: String(error) }
      }
      completed.add(parent)
      exec.concludeTurn()
      return { answer: verdict.answer, selectedExpert: verdict.selectedExpert, experts, critic }
    },
  }
}

/** Install heterogeneous expert execution and one evidence-aware critic vote. */
export function applyOAgent(ctx: Context, config: OAgentConfig): void {
  for (const [name, value] of [['peWorkers', config.peWorkers], ['reactWorkers', config.reactWorkers]] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`oagent ${name} must be a non-negative safe integer`)
  }
  if (config.peWorkers + config.reactWorkers < 2) throw new Error('oagent requires at least two experts')
  if (config.provider.trim().length === 0) throw new Error('oagent provider must be non-empty')
  if (!Number.isSafeInteger(config.criticMaxTokens) || config.criticMaxTokens < 1) throw new Error('oagent criticMaxTokens must be a positive safe integer')
  if (!Number.isSafeInteger(config.controllerReminderLimit) || config.controllerReminderLimit < 0) throw new Error('oagent controllerReminderLimit must be a non-negative safe integer')
  const completed = new WeakSet<Agent>()
  const reminders = new WeakMap<Agent, number>()
  ctx.tools.register(runTool(ctx, config, completed))
  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (agent.session.header.parentSession !== undefined || completed.has(agent)) return
    const count = reminders.get(agent) ?? 0
    if (count >= config.controllerReminderLimit) return
    reminders.set(agent, count + 1)
    agent.steer(createUserMessage({
      source: { kind: 'plugin', plugin: OAGENT_SOURCE },
      content: [{ type: 'text', text: `Do not answer in prose. Call ${RUN_TOOL} now; it runs all experts, performs the critic vote, and returns the final answer.` }],
    }))
  })
  registerHarnessPrompt(ctx, {
    id: 'oagent',
    text: ({ agent }) => agent?.session.header.parentSession === undefined
      ? `Operate only as the OAgent coordinator. Immediately call ${RUN_TOOL} with an empty object. Do not solve the task yourself and do not call ordinary task tools; the composite tool runs one Plan-and-Execute expert, two ReAct experts, and the critic, then concludes the turn.`
      : '',
  })
  installHarnessProtocol(ctx, {
    id: 'oagent',
    resolve: agent => agent.session.header.parentSession !== undefined
      ? { id: 'expert', context: '' }
      : {
          id: 'coordinate', context: '', allowedTools: new Set([RUN_TOOL]),
          denial: `OAgent coordinator must call ${RUN_TOOL}; ordinary task tools belong to its experts.`,
        },
  })
}
