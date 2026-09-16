import { readFileSync } from 'node:fs'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { foldGamState, initialGamState, renderGamCheckpoint, renderGamPrompt } from '../src/index.js'
import type { GamState } from '../src/index.js'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

function addPage(state: GamState, step: number, text: string): GamState {
  const callId = `call-${step}`
  let next = foldGamState(state, event({
    type: 'tool/call', seq: step * 3, time: 0,
    data: { turn: 1, step, callId, name: 'bash', arguments: JSON.stringify({ command: text }) },
  }))
  next = foldGamState(next, event({
    type: 'tool/result', seq: step * 3 + 1, time: 0,
    data: { turn: 1, step, message: { content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }], isError: false }] } },
  }))
  return foldGamState(next, event({ type: 'step/end', seq: step * 3 + 2, time: 0, data: { turn: 1, step } }))
}

function memorizeAll(state: GamState, step: number): GamState {
  const pages = state.pages.filter(page => page.abstract === null)
    .map(page => ({ pageId: page.id, abstract: `Abstract for ${page.content}` }))
  const callId = `memory-${step}`
  let next = foldGamState(state, event({
    type: 'tool/call', seq: 100 + step * 2, time: 0,
    data: { turn: 1, step: 100 + step, callId, name: 'gam_memorize_pages', arguments: JSON.stringify({ pages }) },
  }))
  return foldGamState(next, event({
    type: 'tool/result', seq: 101 + step * 2, time: 0,
    data: { turn: 1, step: 100 + step, message: { content: [{ type: 'tool-result', toolCallId: callId, content: [], isError: false }] } },
  }))
}

describe('GAM Harness', () => {
  it('keeps complete pages and requires model-written abstracts', () => {
    let state = foldGamState(initialGamState(), event({
      type: 'user/message', seq: 0, time: 0,
      data: { id: 'user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Investigate the task.' }] },
    }))
    state = addPage(state, 1, 'ALPHA evidence')
    expect(state.originalTask).toBe('Investigate the task.')
    expect(state.pages[0]).toMatchObject({ id: 'page-0', content: 'ALPHA evidence', abstract: null })
    expect(renderGamPrompt(state, 4)).toContain('call gam_memorize_pages')

    state = memorizeAll(state, 1)
    expect(state.pages[0]?.abstract).toBe('Abstract for ALPHA evidence')
    expect(renderGamPrompt(state, 4)).toContain('Memory catalogue')
  })

  it('requires research, persists integration, and records a completed fold', () => {
    let state = initialGamState()
    for (let step = 1; step <= 4; step += 1) state = memorizeAll(addPage(state, step, `evidence-${step}`), step)
    expect(state.actionSteps).toBe(4)
    expect(renderGamPrompt(state, 4)).toContain('GAM research is due')

    const callId = 'integrate-1'
    state = foldGamState(state, event({
      type: 'tool/call', seq: 200, time: 0,
      data: { turn: 1, step: 20, callId, name: 'gam_integrate_memory', arguments: JSON.stringify({ summary: 'All four facts are retained.', sourcePageIds: ['page-0', 'page-1', 'page-2', 'page-3'] }) },
    }))
    state = foldGamState(state, event({
      type: 'tool/result', seq: 201, time: 0,
      data: { turn: 1, step: 20, message: { content: [{ type: 'tool-result', toolCallId: callId, content: [], isError: false }] } },
    }))
    expect(state.integratedMemory).toBe('All four facts are retained.')
    expect(state.integratedAt).toBe(4)
    expect(renderGamCheckpoint(state)).toContain('already complete: do not repeat them')
    expect(renderGamCheckpoint(state)).toContain('All four facts are retained.')

    state = foldGamState(state, event({
      type: 'user/message', seq: 202, time: 0,
      data: { id: 'gam-fold', role: 'user', source: { kind: 'plugin', plugin: 'harness-all-in-dsh:gam' }, content: [{ type: 'text', text: 'checkpoint' }] },
    }))
    expect(state.foldedAt).toBe(4)
  })

  it('configures four-step research and five parallel action slots', () => {
    const profile = readFileSync(new URL('../profiles/gam.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: gam')
    expect(profile).toContain('reorgInterval: 4')
    expect(profile).toContain('maxParallelToolCalls: 5')
  })
})
