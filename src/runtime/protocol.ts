import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

/** Enforcement policy for advisory Harness protocol phases. */
export type HarnessProtocolMode = 'guided' | 'strict'

/** One response-stable Harness phase resolved before the model request. */
export interface HarnessProtocolPhase {
  /** Stable phase identity used by tests and diagnostics. */
  readonly id: string
  /** Replayable state and current instructions shown to the model. */
  readonly context: string
  /** Tool names admitted during this response; omission admits every visible tool. */
  readonly allowedTools?: ReadonlySet<string>
  /** Tool names hidden and denied while every other visible tool remains admitted. */
  readonly deniedTools?: ReadonlySet<string>
  /** Harness-specific admission rule for compositional tool families. */
  readonly allows?: (tool: string) => boolean
  /** Explanation returned only when the model calls a tool hidden by this phase. */
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

function filterTools(assembly: PromptAssembly, phase: HarnessProtocolPhase): PromptAssembly {
  if (phase.allowedTools === undefined && phase.deniedTools === undefined) return assembly
  return { ...assembly, tools: assembly.tools.filter(tool => admits(phase, tool.name)) }
}

function admits(phase: HarnessProtocolPhase, tool: string): boolean {
  return (phase.allowedTools === undefined || phase.allowedTools.has(tool))
    && phase.deniedTools?.has(tool) !== true
    && (phase.allows === undefined || phase.allows(tool))
}

/**
 * Install one response-atomic Harness protocol.
 *
 * Prompt assembly resolves the phase, contributes its runtime context, and
 * hides tools the phase cannot admit. `agent/pre-step` then seals that exact
 * phase for the complete model response, so tool results cannot change the
 * admission decision for later calls from the same response.
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
    return filterTools({ ...resolved, contexts }, phase)
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
    return phase.denial ?? `Harness protocol phase "${phase.id}" does not allow ${exec.name}.`
  })

  return {
    candidate: agent => candidates.get(agent),
    active: agent => active.get(agent),
  }
}
