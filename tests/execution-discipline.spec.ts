import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { nextExecutionAdvisory, recoverableFailureSignature } from '../src/runtime/execution-discipline.js'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

function call(seq: number, id: string, name = 'web_fetch'): SessionEvent {
  return event({ type: 'tool/call', seq, time: 0, data: { turn: 1, step: seq, callId: id, name, arguments: '{}' } })
}

function result(seq: number, id: string, text: string, isError = true): SessionEvent {
  return event({ type: 'tool/result', seq, time: 0, data: { turn: 1, step: seq, message: { content: [{ toolCallId: id, content: [{ type: 'text', text }], isError }] } } })
}

describe('shared execution discipline', () => {
  it('classifies recoverable failures without treating arbitrary task errors as infrastructure', () => {
    expect(recoverableFailureSignature('Error: web fetch failed: TypeError: fetch failed')).toBe('web fetch failed')
    expect(recoverableFailureSignature('Error: tool call timed out after 30000ms')).toBe('tool call timed out')
    expect(recoverableFailureSignature('Error: file does not exist')).toBeUndefined()
  })

  it('advises after the second matching failure and does not deny the call', () => {
    const events = [
      call(1, 'a'), result(2, 'a', 'Error: web fetch failed: TypeError: fetch failed'),
      call(3, 'b'), result(4, 'b', 'Error: web fetch failed: TypeError: terminated'),
    ]
    expect(nextExecutionAdvisory(events)).toEqual({ tool: 'web_fetch', signature: 'web fetch failed', count: 2 })
  })

  it('does not repeat an advisory already recorded in the Session', () => {
    const marker = 'Failure pattern: {"tool":"web_fetch","signature":"web fetch failed"}'
    const events = [
      call(1, 'a'), result(2, 'a', 'Error: web fetch failed'),
      call(3, 'b'), result(4, 'b', 'Error: web fetch failed'),
      event({ type: 'user/message', seq: 5, time: 0, data: { source: { kind: 'plugin', plugin: 'harness-all-in-dsh:execution-discipline' }, content: [{ type: 'text', text: marker }] } }),
    ]
    expect(nextExecutionAdvisory(events)).toBeUndefined()
  })

  it('ignores protocol denials', () => {
    const events = [
      call(1, 'a'), result(2, 'a', 'Error: [harness-protocol] denied'),
      call(3, 'b'), result(4, 'b', 'Error: [harness-protocol] denied'),
    ]
    expect(nextExecutionAdvisory(events)).toBeUndefined()
  })
})
