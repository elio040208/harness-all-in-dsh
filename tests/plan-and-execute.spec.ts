import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  foldLinearPlanState,
  initialLinearPlanState,
  renderPlanAndExecuteContext,
} from '../src/harnesses/plan-and-execute.js'
import type { LinearPlanState } from '../src/harnesses/plan-and-execute.js'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

describe('Plan-and-Execute Harness', () => {
  it('requires and then replays the accepted linear roadmap', () => {
    let state = initialLinearPlanState()
    expect(renderPlanAndExecuteContext(state, 8)).toContain('call submit_plan')

    state = foldLinearPlanState(state, event({
      type: 'tool/call', seq: 0, time: 0,
      data: { turn: 1, step: 1, callId: 'plan-1', name: 'submit_plan', arguments: JSON.stringify({ steps: ['Inspect', 'Change', 'Verify'] }) },
    }))
    state = foldLinearPlanState(state, event({
      type: 'tool/result', seq: 1, time: 0,
      data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'plan-1', content: [], isError: false }] } },
    }))

    expect(state.plan).toEqual(['Inspect', 'Change', 'Verify'])
    expect(renderPlanAndExecuteContext(state, 8)).toContain('1. Inspect\n2. Change\n3. Verify')
  })

  it('requests a durable progress review at the configured interval', () => {
    let state: LinearPlanState = { ...initialLinearPlanState(), plan: ['Inspect', 'Change', 'Verify'] }
    for (let step = 1; step <= 8; step += 1) {
      state = foldLinearPlanState(state, event({ type: 'step/end', seq: step, time: 0, data: { turn: 1, step } }))
    }
    expect(state.actionSteps).toBe(8)
    expect(renderPlanAndExecuteContext(state, 8)).toContain('call record_progress')

    state = foldLinearPlanState(state, event({
      type: 'tool/call', seq: 9, time: 0,
      data: { turn: 1, step: 9, callId: 'summary-1', name: 'record_progress', arguments: JSON.stringify({ summary: 'Inspection and change complete; verify next.' }) },
    }))
    state = foldLinearPlanState(state, event({
      type: 'tool/result', seq: 10, time: 0,
      data: { turn: 1, step: 9, message: { content: [{ type: 'tool-result', toolCallId: 'summary-1', content: [], isError: false }] } },
    }))
    expect(state.latestSummary).toBe('Inspection and change complete; verify next.')
    expect(renderPlanAndExecuteContext(state, 8)).not.toContain('call record_progress')
  })

  it('does not accept a failed roadmap submission', () => {
    let state = foldLinearPlanState(initialLinearPlanState(), event({
      type: 'tool/call', seq: 0, time: 0,
      data: { turn: 1, step: 1, callId: 'plan-1', name: 'submit_plan', arguments: JSON.stringify({ steps: ['Inspect', 'Change', 'Verify'] }) },
    }))
    state = foldLinearPlanState(state, event({
      type: 'tool/result', seq: 1, time: 0,
      data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'plan-1', content: [], isError: true }] } },
    }))
    expect(state.plan).toBeNull()
  })
})
