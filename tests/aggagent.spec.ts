import { readFileSync } from 'node:fs'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  formatTrajectoryMetadata,
  rougeLRecall,
  searchTrajectory,
  trajectoryFromEvents,
  trajectorySegment,
  trajectorySolutions,
} from '../src/index.js'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

describe('AggAgent Harness', () => {
  const trajectory = trajectoryFromEvents(1, 'child-1', 'completed', [
    event({ type: 'user/message', seq: 0, time: 0, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Find ALPHA.' }] } }),
    event({ type: 'assistant/message', seq: 1, time: 0, data: { step: 1, message: { content: [] } } }),
    event({ type: 'tool/call', seq: 2, time: 0, data: { step: 1, callId: 'call-1', name: 'search', arguments: '{"q":"ALPHA"}' } }),
    event({ type: 'tool/result', seq: 3, time: 0, data: { step: 1, message: { content: [{ toolCallId: 'call-1', content: [{ type: 'text', text: 'Observed ALPHA=42 from the source.' }] }] } } }),
    event({ type: 'assistant/message', seq: 4, time: 0, data: { step: 2, message: { content: [{ type: 'text', text: 'The answer is 42.' }] } } }),
  ])

  it('captures native calls and observations as a searchable trajectory', () => {
    expect(trajectory.steps[1]?.toolCalls).toEqual([{ name: 'search', arguments: '{"q":"ALPHA"}' }])
    expect(searchTrajectory(trajectory, 'ALPHA 42', 'tool', 5)).toMatchObject([
      { step: 3, role: 'tool', toolName: 'search', score: 1 },
    ])
    expect(trajectorySolutions([trajectory])).toEqual([{ trajectoryId: 1, content: 'The answer is 42.' }])
  })

  it('keeps protocol denials out of aggregated trajectories', () => {
    const denied = trajectoryFromEvents(2, 'child-2', 'completed', [
      event({ type: 'assistant/message', seq: 1, time: 0, data: { step: 1, message: { content: [] } } }),
      event({ type: 'tool/call', seq: 2, time: 0, data: { step: 1, callId: 'denied', name: 'bash', arguments: '{}' } }),
      event({ type: 'tool/result', seq: 3, time: 0, data: { step: 1, message: { content: [{ toolCallId: 'denied', content: [{ type: 'text', text: 'Error: [harness-protocol] coordinator only' }], isError: true }] } } }),
    ])
    expect(denied.steps).toEqual([])
  })

  it('implements ROUGE-L recall and clamps segments to five steps', () => {
    expect(rougeLRecall('alpha 42', 'Observed alpha equals 42')).toBe(1)
    expect(trajectorySegment({ ...trajectory, steps: Array.from({ length: 8 }, (_, index) => ({ role: 'assistant' as const, content: `step ${index + 1}` })) }, 2, 8))
      .toHaveLength(5)
  })

  it('formats compact metadata and configures four isolated spawn rollouts', () => {
    expect(formatTrajectoryMetadata([trajectory])).toContain('search×1')
    const profile = readFileSync(new URL('../profiles/aggagent.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: aggagent')
    expect(profile).toContain('rolloutCount: 4')
    expect(profile).toContain('subagentProvider: spawn')
  })
})
