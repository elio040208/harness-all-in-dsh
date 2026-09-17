import { readFileSync } from 'node:fs'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  assertValidDag,
  foldFlashSearcherState,
  initialFlashSearcherState,
  readyDagNodeIds,
  renderFlashSearcherContext,
} from '../src/index.js'
import type { FlashGoal, FlashSearcherState } from '../src/index.js'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

const goals: readonly FlashGoal[] = [
  {
    id: 'facts', name: 'Collect facts', dependsOn: [],
    paths: [{ approach: 'Read the primary source', successCriteria: 'Facts are cited' }],
  },
  {
    id: 'verify', name: 'Verify facts', dependsOn: ['facts'],
    paths: [{ approach: 'Cross-check independently', successCriteria: 'Claims agree' }],
  },
]

describe('Flash-Searcher Harness', () => {
  it('validates dependencies and selects only ready unresolved goals', () => {
    expect(() => assertValidDag(goals)).not.toThrow()
    expect(readyDagNodeIds(goals, new Set())).toEqual(['facts'])
    expect(readyDagNodeIds(goals, new Set(['facts']))).toEqual(['verify'])
    expect(() => assertValidDag([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ])).toThrow('cycle')
  })

  it('persists an accepted DAG and renders dependency-aware execution state', () => {
    let state = initialFlashSearcherState()
    expect(renderFlashSearcherContext(state, 8)).toContain('call submit_dag_plan')
    state = foldFlashSearcherState(state, event({
      type: 'tool/call', seq: 0, time: 0,
      data: { turn: 1, step: 1, callId: 'plan-1', name: 'submit_dag_plan', arguments: JSON.stringify({ goals }) },
    }))
    state = foldFlashSearcherState(state, event({
      type: 'tool/result', seq: 1, time: 0,
      data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'plan-1', content: [], isError: false }] } },
    }))
    expect(state.goals).toEqual(goals)
    expect(renderFlashSearcherContext(state, 8)).toContain('Ready goals: facts')
    expect(renderFlashSearcherContext(state, 8)).toContain('Depends on: facts')
  })

  it('requires a full graph review at the configured interval', () => {
    let state: FlashSearcherState = { ...initialFlashSearcherState(), goals }
    for (let step = 1; step <= 8; step += 1) {
      state = foldFlashSearcherState(state, event({ type: 'step/end', seq: step, time: 0, data: { turn: 1, step } }))
    }
    expect(renderFlashSearcherContext(state, 8)).toContain('call record_dag_review')
    expect(renderFlashSearcherContext(state, 8, 'guided')).toContain('Call record_dag_review soon')
    expect(renderFlashSearcherContext(state, 8, 'guided')).not.toContain('Before another task action')

    const review = [
      { goalId: 'facts', status: 'completed', activePath: 1, result: 'Primary facts collected.', nextAction: 'No action.' },
      { goalId: 'verify', status: 'in-progress', activePath: 1, result: 'Verification started.', nextAction: 'Finish cross-check.' },
    ]
    state = foldFlashSearcherState(state, event({
      type: 'tool/call', seq: 9, time: 0,
      data: { turn: 1, step: 9, callId: 'review-1', name: 'record_dag_review', arguments: JSON.stringify({ goals: review }) },
    }))
    state = foldFlashSearcherState(state, event({
      type: 'tool/result', seq: 10, time: 0,
      data: { turn: 1, step: 9, message: { content: [{ type: 'tool-result', toolCallId: 'review-1', content: [], isError: false }] } },
    }))
    expect(renderFlashSearcherContext(state, 8)).toContain('Ready goals: verify')
    expect(renderFlashSearcherContext(state, 8)).not.toContain('call record_dag_review')
  })

  it('enables five DSH-native parallel tool slots in its profile', () => {
    const profile = readFileSync(
      new URL('../profiles/flash-searcher.cordis.patch.yml', import.meta.url),
      'utf8',
    )
    expect(profile).toContain('harness: flash-searcher')
    expect(profile).toContain('maxParallelToolCalls: 5')
  })
})
