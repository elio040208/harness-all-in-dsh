import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { oagentExpertDigest, parseOAgentCriticVerdict } from '../src/index.js'
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
  it('builds the bounded critic view from native trajectory evidence', () => {
    expect(oagentExpertDigest('PE-Worker-1', trajectory)).toEqual({
      name: 'PE-Worker-1', answer: 'The answer is 42.',
      evidence: [{ tool: 'search', observation: 'The source reports ALPHA=42.' }],
      sessionId: 'expert-session', stopReason: 'completed',
    })
  })

  it('accepts exact critic JSON and rejects unknown experts', () => {
    const experts = [oagentExpertDigest('PE-Worker-1', trajectory)]
    expect(parseOAgentCriticVerdict('```json\n{"selected_expert":"PE-Worker-1","answer":"42"}\n```', experts))
      .toEqual({ selectedExpert: 'PE-Worker-1', answer: '42' })
    expect(() => parseOAgentCriticVerdict('{"selected_expert":"missing","answer":"42"}', experts)).toThrow(/existing expert/u)
  })

  it('configures the fixed one-PE two-ReAct ensemble', () => {
    const profile = readFileSync(new URL('../profiles/oagent.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: oagent')
    expect(profile).toContain('peWorkerCount: 1')
    expect(profile).toContain('reactWorkerCount: 2')
    expect(profile).toContain('controllerReminderLimit: 2')
  })
})
