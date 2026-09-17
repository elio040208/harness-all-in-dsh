import { readFileSync } from 'node:fs'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  foldHiAgentState,
  hiAgentSimilarity,
  initialHiAgentState,
  renderHiAgentWorkspace,
  selectHiAgentInteractions,
} from '../src/index.js'
import type { HiAgentState, ToolEpisode } from '../src/index.js'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

function episode(id: number, result: string): ToolEpisode {
  return {
    id, agentStep: id + 1, explanation: `reason-${id}`,
    actions: [{ tool: 'lookup', arguments: JSON.stringify({ id }), result, isError: false }],
    relatedSeqs: [id * 3 + 1, id * 3 + 2, id * 3 + 3],
  }
}

describe('HiAgent Harness', () => {
  it('groups complete tool episodes through the shared trajectory component', () => {
    let state = foldHiAgentState(initialHiAgentState(), event({
      type: 'user/message', seq: 1, time: 0,
      data: { id: 'task', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Find the result.' }] },
    }))
    state = foldHiAgentState(state, event({
      type: 'assistant/message', seq: 2, time: 0,
      data: { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'Inspect it.' }, { type: 'tool-call', id: 'c1', name: 'lookup', arguments: '{}' }] } },
    }))
    state = foldHiAgentState(state, event({ type: 'tool/call', seq: 3, time: 0, data: { turn: 1, step: 1, callId: 'c1', name: 'lookup', arguments: '{}' } }))
    state = foldHiAgentState(state, event({
      type: 'tool/result', seq: 4, time: 0,
      data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'FACT' }], isError: false }] } },
    }))
    state = foldHiAgentState(state, event({ type: 'step/end', seq: 5, time: 0, data: { turn: 1, step: 1 } }))
    expect(state.originalTask).toBe('Find the result.')
    expect(state.interactions[0]).toMatchObject({ id: 0, explanation: 'Inspect it.', actions: [{ result: 'FACT' }], relatedSeqs: [2, 3, 4] })
  })

  it('does not turn protocol denials into trajectory interactions', () => {
    let state = initialHiAgentState()
    state = foldHiAgentState(state, event({
      type: 'assistant/message', seq: 1, time: 0,
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Try it.' }] } },
    }))
    state = foldHiAgentState(state, event({ type: 'tool/call', seq: 2, time: 0, data: { turn: 1, step: 1, callId: 'denied', name: 'bash', arguments: '{}' } }))
    state = foldHiAgentState(state, event({
      type: 'tool/result', seq: 3, time: 0,
      data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'denied', content: [{ type: 'text', text: 'Error: [harness-protocol] coordinator only' }], isError: true }] } },
    }))
    state = foldHiAgentState(state, event({ type: 'step/end', seq: 4, time: 0, data: { turn: 1, step: 1 } }))
    expect(state.interactions).toEqual([])
    expect(state.calls).toEqual({})
    expect(state.assistants).toEqual({})
  })

  it('uses TF-IDF novelty and always retains trajectory boundaries', () => {
    expect(hiAgentSimilarity('alpha beta', 'alpha beta')).toBeCloseTo(1)
    expect(hiAgentSimilarity('alpha beta', 'gamma delta')).toBe(0)
    const interactions = [
      episode(0, 'initial'), episode(1, 'same evidence'), episode(2, 'same evidence'),
      episode(3, 'novel omega'), episode(4, 'another branch'), episode(5, 'latest'),
    ]
    const selected = selectHiAgentInteractions(interactions, 4)
    expect(selected.size).toBe(4)
    expect(selected.has(0)).toBe(true)
    expect(selected.has(5)).toBe(true)
  })

  it('renders omitted placeholders without deleting the complete trajectory', () => {
    const interactions = [episode(0, 'a'), episode(1, 'b'), episode(2, 'c'), episode(3, 'd'), episode(4, 'e')]
    const state: HiAgentState = { ...initialHiAgentState(), originalTask: 'Goal', interactions }
    const workspace = renderHiAgentWorkspace(state, 3)
    expect(workspace).toContain('### Goal\nGoal')
    expect(workspace).toContain('[0] Reasoning: reason-0')
    expect(workspace).toContain('[4] Reasoning: reason-4')
    expect(workspace.match(/Omitted: Action-Observation pair/g)).toHaveLength(2)
    expect(state.interactions).toHaveLength(5)

    const profile = readFileSync(new URL('../profiles/hiagent.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: hiagent')
    expect(profile).toContain('hiAgentMemorySize: 15')
    expect(profile).toContain('maxParallelToolCalls: 1')
  })
})
