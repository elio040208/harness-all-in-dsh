import { readFileSync } from 'node:fs'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  applyMemoGraphPatch,
  applyMemoRecall,
  foldMemoBrainState,
  initialMemoBrainState,
  renderMemoCheckpoint,
  renderMemoGraph,
} from '../src/index.js'
import type { MemoBrainState } from '../src/index.js'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

function taskState(): MemoBrainState {
  return foldMemoBrainState(initialMemoBrainState(), event({
    type: 'user/message', seq: 1, time: 0,
    data: { id: 'task', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Find the answer.' }] },
  }))
}

describe('MemoBrain Harness', () => {
  it('groups a complete assistant/tool episode for passive memorization', () => {
    let state = taskState()
    state = foldMemoBrainState(state, event({
      type: 'assistant/message', seq: 2, time: 0,
      data: { turn: 1, step: 1, message: { role: 'assistant', source: { provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'I will inspect the evidence.' }] }, stream: [] },
    }))
    state = foldMemoBrainState(state, event({
      type: 'tool/call', seq: 3, time: 0,
      data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"printf FACT"}' },
    }))
    state = foldMemoBrainState(state, event({
      type: 'tool/result', seq: 4, time: 0,
      data: { turn: 1, step: 1, message: { role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'FACT' }], isError: false }] } },
    }))
    expect(state.originalTask).toBe('Find the answer.')
    expect(state.pendingEpisodes[0]).toMatchObject({
      id: 'call-1', assistant: 'I will inspect the evidence.', tool: 'bash', result: 'FACT', relatedSeqs: [2, 3, 4],
    })

    state = foldMemoBrainState(state, event({
      type: 'user/message', seq: 5, time: 0,
      data: {
        id: 'memory-1', role: 'user', source: { kind: 'plugin', plugin: 'harness-all-in-dsh:memobrain' },
        content: [{ type: 'text', text: JSON.stringify({
          kind: 'memory', episodeId: 'call-1', provider: 'p', model: 'm', rawOutput: '{}',
          patch: {
            addNodes: [{ tempId: 'fact', kind: 'evidence', notes: [{ role: 'tool', content: 'FACT' }] }],
            addEdges: [{ src: 1, dst: 'fact', rationale: 'supports the task' }],
          },
        }) }],
      },
    }))
    expect(state.pendingEpisodes).toEqual([])
    expect(state.processedEpisodes).toBe(1)
    expect(state.nodes[1]).toMatchObject({ id: 2, kind: 'evidence', relatedSeqs: [2, 3, 4] })
  })

  it('validates dependency patches and rejects graph cycles', () => {
    const state = taskState()
    const graph = applyMemoGraphPatch(state, {
      addNodes: [
        { tempId: 'subtask', kind: 'subtask', notes: [{ role: 'assistant', content: 'Inspect one fact.' }] },
        { tempId: 'evidence', kind: 'evidence', notes: [{ role: 'user', content: 'The fact is confirmed.' }] },
      ],
      addEdges: [
        { src: 1, dst: 'subtask', rationale: 'decomposes the task' },
        { src: 'subtask', dst: 'evidence', rationale: 'supports the subtask' },
      ],
    }, [2, 3, 4])
    expect(graph.nodes.map(node => node.kind)).toEqual(['task', 'subtask', 'evidence'])
    expect(graph.edges).toEqual([
      { src: 1, dst: 2, rationale: 'decomposes the task' },
      { src: 2, dst: 3, rationale: 'supports the subtask' },
    ])
    expect(() => applyMemoGraphPatch({ ...state, ...graph }, {
      addNodes: [], addEdges: [{ src: 3, dst: 1, rationale: 'cycle' }],
    }, [])).toThrow('cycle')
  })

  it('flushes redundant nodes and folds completed paths with edge rewiring', () => {
    const base = taskState()
    const graph = applyMemoGraphPatch(base, {
      addNodes: [
        { tempId: 'old', kind: 'subtask', notes: [{ role: 'assistant', content: 'Old route' }] },
        { tempId: 'subtask', kind: 'subtask', notes: [{ role: 'assistant', content: 'Useful route' }] },
        { tempId: 'evidence', kind: 'evidence', notes: [{ role: 'user', content: 'Confirmed result' }] },
      ],
      addEdges: [
        { src: 1, dst: 'old', rationale: 'candidate' },
        { src: 1, dst: 'subtask', rationale: 'decomposition' },
        { src: 'subtask', dst: 'evidence', rationale: 'support' },
      ],
    }, [10, 11])
    const state = { ...base, ...graph }
    const recalled = applyMemoRecall(state, {
      flush: [{ id: 2, rationale: 'superseded' }],
      folds: [{ ids: [3, 4], rationale: 'completed path', notes: [{ role: 'user', content: 'The useful route confirmed the result.' }] }],
    })
    expect(recalled.nodes.find(node => node.id === 2)?.status).toBe('flushed')
    expect(recalled.nodes.filter(node => node.id === 3 || node.id === 4).every(node => node.status === 'folded')).toBe(true)
    expect(recalled.nodes.at(-1)).toMatchObject({ id: 5, kind: 'summary', status: 'active', relatedSeqs: [10, 11] })
    expect(recalled.edges).toContainEqual({ src: 1, dst: 5, rationale: 'completed path' })
  })

  it('renders the optimized graph and protected transcript as established context', () => {
    const state = taskState()
    expect(renderMemoGraph(state)).toContain('Node 1 [task] [active]')
    const checkpoint = renderMemoCheckpoint(state, 'tool result: FACT')
    expect(checkpoint).toContain('Original task:\nFind the answer.')
    expect(checkpoint).toContain('earlier trajectory')
    expect(checkpoint).toContain('tool result: FACT')
  })

  it('configures passive recall at one quarter of the context window', () => {
    const profile = readFileSync(new URL('../profiles/memobrain.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: memobrain')
    expect(profile).toContain('memoryThresholdRatio: 0.25')
    expect(profile).toContain('maxParallelToolCalls: 1')
  })
})
