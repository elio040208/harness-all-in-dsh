import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { contentText } from './content.js'

/** Stable marker that lets projections exclude protocol denials from task evidence. */
export const HARNESS_PROTOCOL_DENIAL_PREFIX = '[harness-protocol]'

/** One response-stable Harness phase resolved before the model request. */
export interface HarnessProtocolPhase {
  /** Stable phase identity used by tests and diagnostics. */
  readonly id: string
  /** Replayable state and current instructions shown to the model. */
  readonly context: string
  /** Tool names admitted during this response; omission admits every registered tool. */
  readonly allowedTools?: ReadonlySet<string>
  /** Tool names denied while every other registered tool remains admitted. */
  readonly deniedTools?: ReadonlySet<string>
  /** Harness-specific admission rule for compositional tool families. */
  readonly allows?: (tool: string) => boolean
  /** Explanation returned only when the model calls a tool denied by this phase. */
  readonly denial?: string
}

/** Per-agent phase resolver installed by one Harness implementation. */
export interface HarnessProtocol {
  readonly id: string
  resolve(agent: Agent): HarnessProtocolPhase
}

/** Runtime handle exposed for focused phase-snapshot tests. */
export interface HarnessProtocolHandle {
  candidate(agent: Agent): HarnessProtocolPhase | undefined
  active(agent: Agent): HarnessProtocolPhase | undefined
}

function admits(phase: HarnessProtocolPhase, tool: string): boolean {
  return (phase.allowedTools === undefined || phase.allowedTools.has(tool))
    && phase.deniedTools?.has(tool) !== true
    && (phase.allows === undefined || phase.allows(tool))
}

/** Return whether a tool result records a Harness admission rejection rather than task evidence. */
export function isHarnessProtocolDenialResult(event: SessionEvent): boolean {
  if (event.type !== 'tool/result') return false
  const block = event.data.message.content[0]
  return block.isError === true
    && contentText(block.content).startsWith(`Error: ${HARNESS_PROTOCOL_DENIAL_PREFIX}`)
}

/**
 * Install one response-atomic Harness protocol.
 *
 * Prompt assembly resolves the phase and contributes its runtime context
 * without changing the model-facing tool catalogue. `agent/pre-step` then
 * seals that exact phase for the complete model response, so tool results
 * cannot change the admission decision for later calls from the same response.
 *
 * @param ctx - Harness plugin context.
 * @param protocol - Harness-owned phase resolver.
 * @returns A read-only handle for focused tests and diagnostics.
 */
export function installHarnessProtocol(ctx: Context, protocol: HarnessProtocol): HarnessProtocolHandle {
  const candidates = new WeakMap<Agent, HarnessProtocolPhase>()
  const active = new WeakMap<Agent, HarnessProtocolPhase>()
  const contextName = `harness-all-in-dsh:${protocol.id}:state`

  ctx.on('system-prompt/assemble', async (assembly, assembleContext, next) => {
    const resolved = await next()
    const agent = assembleContext.agent
    if (agent === undefined) return resolved
    const phase = protocol.resolve(agent)
    candidates.set(agent, phase)
    const contexts = resolved.contexts.filter(context => context.name !== contextName)
    if (phase.context.length > 0) contexts.push({ name: contextName, text: phase.context })
    return { ...resolved, contexts }
  })

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    active.set(agent, candidates.get(agent) ?? protocol.resolve(agent))
    return await next()
  })

  ctx.tools.guard((exec) => {
    const agent = exec.agent
    if (agent === undefined) return undefined
    const phase = active.get(agent) ?? protocol.resolve(agent)
    if (admits(phase, exec.name)) return undefined
    const reason = phase.denial ?? `Harness protocol phase "${phase.id}" does not allow ${exec.name}.`
    return `${HARNESS_PROTOCOL_DENIAL_PREFIX} ${reason}`
  })

  return {
    candidate: agent => candidates.get(agent),
    active: agent => active.get(agent),
  }
}
