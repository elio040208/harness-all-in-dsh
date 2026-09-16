import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import { trajectoryFromEvents } from './trajectory.js'
import type { AgentTrajectory } from './trajectory.js'

/** One isolated child-Agent request used by coordinator Harnesses. */
export interface IsolatedAgentRequest {
  readonly id: number
  readonly label: string
  readonly prompt: string
  readonly persona: string
  readonly provider: string
  readonly deniedTools: readonly string[]
  readonly parent: Agent
  readonly signal: AbortSignal
}

/** Run one fresh DSH child Agent and capture its durable Session as a trajectory. */
export async function runIsolatedAgent(ctx: Context, request: IsolatedAgentRequest): Promise<AgentTrajectory> {
  const run = await ctx.subagents.start(request.provider, {
    label: request.label,
    parent: request.parent,
    signal: request.signal,
    maxDepth: 1,
    toolFilter: { deny: [...request.deniedTools] },
    persona: request.persona,
    prompt: [{ type: 'text', text: request.prompt }],
  })
  try {
    const result = await run.result
    const events = run.localAgent?.session.snapshotEvents()
    if (events === undefined) throw new Error(`subagent provider "${request.provider}" did not expose a local child Session`)
    return trajectoryFromEvents(request.id, String(run.id), result.stopReason, events)
  } finally {
    await run.dispose()
  }
}
