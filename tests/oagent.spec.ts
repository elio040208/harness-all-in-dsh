import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { oagentRollout, parseOAgentCriticVerdict } from '../src/index.js'
import type { AgentTrajectory } from '../src/index.js'

const trajectory: AgentTrajectory = {
  id: 1,
  sessionId: 'expert-session',
  stopReason: 'completed',
  steps: [
    { role: 'assistant', content: '', toolCalls: [{ name: 'search', arguments: '{"q":"alpha"}' }] },
    { role: 'tool', toolName: 'search', content: 'The source reports ALPHA=42.' },
    { role: 'assistant', content: 'The answer is 42.' },
  ],
}

describe('OAgent Harness', () => {
  it('builds the complete list-wise trajectory record', () => {
    expect(oagentRollout(1, trajectory)).toEqual({
      rollout: 1, answer: 'The answer is 42.',
      trajectory: '[1] assistant: \nTool call search: {"q":"alpha"}\n\n[2] tool search: The source reports ALPHA=42.\n\n[3] assistant: The answer is 42.',
      sessionId: 'expert-session', stopReason: 'completed',
    })
  })

  it('selects an existing rollout without rewriting its answer', () => {
    const rollouts = [oagentRollout(1, trajectory)]
    expect(parseOAgentCriticVerdict('```json\n{"selected_rollout":1}\n```', rollouts))
      .toEqual({ selectedRollout: 1, answer: 'The answer is 42.' })
    expect(() => parseOAgentCriticVerdict('{"selected_rollout":2}', rollouts)).toThrow(/existing rollout/u)
  })

  it('configures the documented four-rollout BON path', () => {
    const profile = readFileSync(new URL('../profiles/oagent.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: oagent')
    expect(profile).toContain('rolloutCount: 4')
    expect(profile).toContain('controllerReminderLimit: 2')
  })
})
