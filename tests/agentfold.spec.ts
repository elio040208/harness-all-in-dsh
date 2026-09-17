import { readFileSync } from 'node:fs'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  applyAgentFoldSummary,
  foldAgentFoldState,
  initialAgentFoldState,
  renderAgentFoldContext,
  renderAgentFoldWorkspace,
} from '../src/index.js'
import type { AgentFoldState } from '../src/index.js'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

function addInteraction(state: AgentFoldState, step: number, seq: number, result: string): AgentFoldState {
  const callId = `call-${step}`
  let next = foldAgentFoldState(state, event({
    type: 'assistant/message', seq, time: 0,
      data: { turn: 1, step, message: { role: 'assistant', source: { provider: 'p', model: 'm' }, content: [
        { type: 'reasoning', text: `Inspect evidence ${step}.` },
        { type: 'tool-call', id: callId, name: 'bash', arguments: JSON.stringify({ command: `step-${step}` }) },
      ] }, stream: [] },
  }))
  next = foldAgentFoldState(next, event({
    type: 'tool/call', seq: seq + 1, time: 0,
    data: { turn: 1, step, callId, name: 'bash', arguments: JSON.stringify({ command: `step-${step}` }) },
  }))
  next = foldAgentFoldState(next, event({
    type: 'tool/result', seq: seq + 2, time: 0,
    data: { turn: 1, step, message: { content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: result }], isError: false }] } },
  }))
  return foldAgentFoldState(next, event({ type: 'step/end', seq: seq + 3, time: 0, data: { turn: 1, step } }))
}

function applyFold(state: AgentFoldState, step: number, seq: number, start: number, end: number, summary: string): AgentFoldState {
  const callId = `fold-${step}`
  let next = foldAgentFoldState(state, event({
    type: 'tool/call', seq, time: 0,
    data: { turn: 1, step, callId, name: 'agentfold_fold', arguments: JSON.stringify({ start, end, summary }) },
  }))
  return foldAgentFoldState(next, event({
    type: 'tool/result', seq: seq + 1, time: 0,
    data: { turn: 1, step, message: { content: [{ type: 'tool-result', toolCallId: callId, content: [], isError: false }] } },
  }))
}

describe('AgentFold Harness', () => {
  it('retains the latest interaction at full fidelity and folds older steps', () => {
    let state = foldAgentFoldState(initialAgentFoldState(), event({
      type: 'user/message', seq: 1, time: 0,
      data: { id: 'task', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Find ALPHA.' }] },
    }))
    state = addInteraction(state, 1, 2, 'First raw observation')
    expect(state.interactions[0]).toMatchObject({ id: 0, explanation: 'Inspect evidence 1.' })
    expect(renderAgentFoldWorkspace(state)).toContain('Latest Interaction\n**[Step 0]**')
    expect(renderAgentFoldWorkspace(state)).toContain('First raw observation')
    expect(renderAgentFoldContext(state)).toContain('latest full interaction is Step 0')

    state = applyFold(state, 2, 6, 0, 0, 'Step 0 established the first fact.')
    state = addInteraction(state, 2, 8, 'Second raw observation')
    const workspace = renderAgentFoldWorkspace(state)
    expect(workspace).toContain('[Compressed Step 0]')
    expect(workspace).toContain('Step 0 established the first fact.')
    expect(workspace).toContain('Latest Interaction\n**[Step 1]**')
    expect(workspace).toContain('Second raw observation')
    expect(state.foldCount).toBe(1)
  })

  it('supports deep consolidation only from active summary boundaries', () => {
    let state = addInteraction(initialAgentFoldState(), 1, 1, 'one')
    state = applyFold(state, 2, 5, 0, 0, 'one summary')
    state = addInteraction(state, 2, 7, 'two')
    state = applyFold(state, 3, 11, 0, 1, 'Steps 0-1 completed the first subtask.')
    state = addInteraction(state, 3, 13, 'three')

    const consolidated = applyAgentFoldSummary(state, { start: 0, end: 2, summary: 'Steps 0-2 completed both subtasks.' })
    expect(consolidated).toEqual([
      expect.objectContaining({ start: 0, end: 2, text: 'Steps 0-2 completed both subtasks.' }),
    ])
    expect(() => applyAgentFoldSummary(state, { start: 1, end: 2, summary: 'invalid boundary' })).toThrow('summary boundary')
    expect(() => applyAgentFoldSummary(state, { start: 0, end: 1, summary: 'not latest' })).toThrow('latest interaction')
  })

  it('configures a fold directive and one concurrent external action', () => {
    const profile = readFileSync(new URL('../profiles/agentfold.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: agentfold')
    expect(profile).toContain('maxParallelToolCalls: 2')
  })
})
