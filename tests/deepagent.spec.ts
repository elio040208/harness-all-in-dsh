import { readFileSync } from 'node:fs'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { foldDeepAgentState, initialDeepAgentState, renderDeepAgentCheckpoint } from '../src/index.js'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

describe('DeepAgent Harness', () => {
  it('persists three-tier fold results and resets the model workspace', () => {
    let state = foldDeepAgentState(initialDeepAgentState(), event({
      type: 'user/message', seq: 1, time: 0,
      data: { id: 'task', source: { kind: 'user' }, content: [{ type: 'text', text: 'Solve the task.' }] },
    }))
    state = { ...state, interactions: [{
      id: 0, agentStep: 1, explanation: 'Inspect evidence.', relatedSeqs: [2, 3, 4],
      actions: [{ tool: 'lookup', arguments: '{"q":"alpha"}', result: 'ALPHA', isError: false }],
    }] }
    state = foldDeepAgentState(state, event({
      type: 'tool/call', seq: 5, time: 0,
      data: { turn: 1, step: 2, callId: 'fold-1', name: 'deepagent_fold_thoughts', arguments: '{}' },
    }))
    state = foldDeepAgentState(state, event({
      type: 'tool/result', seq: 6, time: 0,
      data: { turn: 1, step: 2, message: { content: [{
        type: 'tool-result', toolCallId: 'fold-1', isError: false, content: [{ type: 'text', text: JSON.stringify({
          number: 1, foldedThrough: 0, episodic: '{"current_progress":"found ALPHA"}',
          working: '{"immediate_goal":"finish"}', tool: '{"derived_rules":["lookup works"]}',
          provider: 'cuhk-sz', model: 'deepseek-v4.1-flash', sourceInteractionIds: [0],
        }) }],
      }] } },
    }))
    expect(state.folds).toHaveLength(1)
    expect(state.folds[0]).toMatchObject({ foldedThrough: 0, sourceInteractionIds: [0] })
    const checkpoint = renderDeepAgentCheckpoint(state)
    expect(checkpoint).toContain('Fold checkpoint #1 is complete.')
    expect(checkpoint).toContain('Episode Memory:')
    expect(checkpoint).toContain('Working Memory:')
    expect(checkpoint).toContain('Tool Memory:')
    expect(checkpoint).not.toContain('Inspect evidence.')
  })

  it('records tool searches as interactions and rejects no fold details from raw history', () => {
    let state = initialDeepAgentState()
    state = foldDeepAgentState(state, event({
      type: 'tool/call', seq: 1, time: 0,
      data: { turn: 1, step: 1, callId: 'search-1', name: 'deepagent_tool_search', arguments: '{"query":"file search","topK":5}' },
    }))
    state = foldDeepAgentState(state, event({
      type: 'tool/result', seq: 2, time: 0,
      data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'search-1', isError: false, content: [{ type: 'text', text: '{"tools":[]}' }] }] } },
    }))
    state = foldDeepAgentState(state, event({ type: 'step/end', seq: 3, time: 0, data: { turn: 1, step: 1 } }))
    expect(state.searches).toEqual(['file search'])
    expect(state.interactions[0]?.actions[0]?.tool).toBe('deepagent_tool_search')
  })

  it('configures one action per turn and three folds', () => {
    const profile = readFileSync(new URL('../profiles/deepagent.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: deepagent')
    expect(profile).toContain('deepAgentMaxFolds: 3')
    expect(profile).toContain('maxParallelToolCalls: 1')
  })
})
