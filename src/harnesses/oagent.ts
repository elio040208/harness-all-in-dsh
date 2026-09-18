import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { auxiliaryText } from '../runtime/auxiliary-llm.js'
import { contentText } from '../runtime/content.js'
import { registerHarnessPrompt } from '../runtime/prompt.js'
import { installHarnessProtocol } from '../runtime/protocol.js'
import { runIsolatedAgent } from '../runtime/subagent-ensemble.js'
import { trajectoryFinalAnswer } from '../runtime/trajectory.js'
import type { AgentTrajectory } from '../runtime/trajectory.js'

const RUN_TOOL = 'oagent_run_ensemble'
const OAGENT_SOURCE = 'harness-all-in-dsh:oagent'

/** OAgent rollout count, child provider, and list-wise judge output budget. */
export interface OAgentConfig {
  readonly rolloutCount: number
  readonly provider: string
  readonly criticMaxTokens: number
  readonly controllerReminderLimit: number
}

/** One complete independent rollout supplied to the list-wise judge. */
export interface OAgentRollout {
  readonly rollout: number
  readonly answer: string
  readonly trajectory: string
  readonly sessionId: string
  readonly stopReason: string
}

/** Parsed list-wise selection and the selected rollout's unchanged answer. */
export interface OAgentCriticVerdict {
  readonly selectedRollout: number
  readonly answer: string
}

function requireAgent(exec: ToolExecution): Agent {
  if (exec.agent === undefined) throw new Error(`${RUN_TOOL} requires an owning DSH Agent`)
  return exec.agent
}

function trajectoryText(trajectory: AgentTrajectory): string {
  return trajectory.steps.map((step, index) => {
    const calls = step.toolCalls?.map(call => `\nTool call ${call.name}: ${call.arguments}`).join('') ?? ''
    const tool = step.toolName === undefined ? '' : ` ${step.toolName}`
    return `[${index + 1}] ${step.role}${tool}: ${step.content}${calls}`
  }).join('\n\n')
}

/** Build the complete trajectory record used by the official list-wise merge. */
export function oagentRollout(rollout: number, trajectory: AgentTrajectory): OAgentRollout {
  return {
    rollout,
    answer: trajectoryFinalAnswer(trajectory) || 'No answer produced',
    trajectory: trajectoryText(trajectory),
    sessionId: trajectory.sessionId,
    stopReason: trajectory.stopReason,
  }
}

function cleanJson(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
}

/** Validate the list-wise judge index and return that rollout's answer unchanged. */
export function parseOAgentCriticVerdict(text: string, rollouts: readonly OAgentRollout[]): OAgentCriticVerdict {
  const value: unknown = JSON.parse(cleanJson(text))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('OAgent judge verdict must be an object')
  const record = value as Record<string, unknown>
  if (!Number.isSafeInteger(record.selected_rollout)) throw new Error('OAgent selected_rollout must be an integer')
  const selectedRollout = record.selected_rollout as number
  const selected = rollouts.find(rollout => rollout.rollout === selectedRollout)
  if (selected === undefined) throw new Error('OAgent selected_rollout must identify an existing rollout')
  return { selectedRollout, answer: selected.answer }
}

function criticPrompt(task: string, rollouts: readonly OAgentRollout[]): string {
  const sections = rollouts.map(rollout => `---Trajectory - ${rollout.rollout}---\n${rollout.trajectory}\nFinal answer: ${rollout.answer}`).join('\n\n')
  return `Task:\n${task}\n\nCandidate trajectories:\n${sections}\n\nSelect the single trajectory that best solves the task. Judge correctness, task compliance, reasoning quality, and observed tool evidence. Do not synthesize or rewrite an answer. Return only JSON with exactly {"selected_rollout":1}, replacing 1 with one listed rollout number.`
}

async function runRollouts(
  ctx: Context,
  parent: Agent,
  task: string,
  config: OAgentConfig,
  signal: AbortSignal,
): Promise<readonly OAgentRollout[]> {
  const rollouts: OAgentRollout[] = []
  for (let index = 0; index < config.rolloutCount; index += 1) {
    const number = index + 1
    const trajectory = await runIsolatedAgent(ctx, {
      id: number,
      label: `OAgent rollout ${number}`,
      prompt: `Independently solve this task as rollout ${number} of ${config.rolloutCount}.\n\n${task}`,
      persona: 'You are one independent OAgent best-of-N rollout. Start by forming a concise task plan, then reason and use the available tools until you can return a complete standalone final answer. Do not delegate, compare rollouts, or discuss selection.',
      provider: config.provider,
      deniedTools: [RUN_TOOL],
      parent,
      signal,
    })
    rollouts.push(oagentRollout(number, trajectory))
  }
  return rollouts
}

function runTool(ctx: Context, config: OAgentConfig, completed: WeakSet<Agent>): ToolDefinition {
  return {
    name: RUN_TOOL,
    description: 'Run sequential independent OAgent rollouts followed by list-wise trajectory selection. This is the only coordinator action.',
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
      const rollouts = await runRollouts(ctx, parent, task, config, exec.signal)
      const fallback = rollouts[0]
      if (fallback === undefined) throw new Error('OAgent produced no rollout results')
      let verdict: OAgentCriticVerdict = { selectedRollout: fallback.rollout, answer: fallback.answer }
      let critic: { provider: string; model: string; rawVerdict: string; error?: string }
      if (rollouts.length === 1) {
        critic = { provider: '', model: '', rawVerdict: '', error: 'List-wise selection skipped because only one rollout was configured.' }
      } else try {
        const result = await auxiliaryText(
          ctx,
          parent,
          'You are the OAgent list-wise trajectory judge. Select one supplied rollout without rewriting its answer. Return only the requested JSON object.',
          criticPrompt(task, rollouts),
          config.criticMaxTokens,
          exec.signal,
        )
        critic = { provider: result.provider, model: result.model, rawVerdict: result.text }
        try {
          verdict = parseOAgentCriticVerdict(result.text, rollouts)
        } catch (error: unknown) {
          critic = { ...critic, error: String(error) }
        }
      } catch (error: unknown) {
        critic = { provider: '', model: '', rawVerdict: '', error: String(error) }
      }
      completed.add(parent)
      exec.concludeTurn()
      return { answer: verdict.answer, selectedRollout: verdict.selectedRollout, rollouts, critic }
    },
  }
}

/** Install official-style sequential best-of-N rollouts and list-wise selection. */
export function applyOAgent(ctx: Context, config: OAgentConfig): void {
  if (!Number.isSafeInteger(config.rolloutCount) || config.rolloutCount < 1) throw new Error('oagent rolloutCount must be a positive safe integer')
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
      content: [{ type: 'text', text: `Do not answer in prose. Call ${RUN_TOOL} now; it runs all rollouts, performs list-wise selection, and returns the selected answer.` }],
    }))
  })
  registerHarnessPrompt(ctx, {
    id: 'oagent',
    text: ({ agent }) => agent?.session.header.parentSession === undefined
      ? `Operate only as the OAgent coordinator. Immediately call ${RUN_TOOL} with an empty object. Do not solve the task yourself and do not call ordinary task tools; the composite tool runs ${config.rolloutCount} independent same-configuration rollouts sequentially, selects one trajectory list-wise, and concludes the turn.`
      : '',
  })
  installHarnessProtocol(ctx, {
    id: 'oagent',
    resolve: agent => agent.session.header.parentSession !== undefined
      ? { id: 'rollout', context: '' }
      : {
          id: 'coordinate', context: '', allowedTools: new Set([RUN_TOOL]),
          denial: `OAgent coordinator must call ${RUN_TOOL}; ordinary task tools belong to its rollouts.`,
        },
  })
}
