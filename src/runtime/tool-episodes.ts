import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { contentText } from './content.js'

/** One external action and its observed result. */
export interface ToolEpisodeAction {
  readonly tool: string
  readonly arguments: string
  readonly result: string
  readonly isError: boolean
}

/** One completed model step containing one or more external actions. */
export interface ToolEpisode {
  readonly id: number
  readonly agentStep: number
  readonly explanation: string
  readonly actions: readonly ToolEpisodeAction[]
  readonly relatedSeqs: readonly number[]
}

/** Replayable partial and completed records used to group Session tool events. */
export interface ToolEpisodeCollection {
  readonly interactions: readonly ToolEpisode[]
  readonly assistants: Readonly<Record<string, { readonly text: string; readonly seq: number }>>
  readonly calls: Readonly<Record<string, { readonly step: number; readonly tool: string; readonly arguments: string; readonly seq: number }>>
  readonly results: Readonly<Record<string, { readonly result: string; readonly isError: boolean; readonly seq: number }>>
}

/** Create an empty tool-episode collection. */
export function initialToolEpisodeCollection(): ToolEpisodeCollection {
  return { interactions: [], assistants: {}, calls: {}, results: {} }
}

function explanation(event: Extract<SessionEvent, { type: 'assistant/message' }>): string {
  const visible = event.data.message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text).join('\n').trim()
  if (visible.length > 0) return visible
  return event.data.message.content
    .filter((block): block is Extract<typeof block, { type: 'reasoning' }> => block.type === 'reasoning')
    .map(block => block.text).join('\n').trim()
}

/** Fold ordinary assistant/tool events into completed tool episodes. */
export function foldToolEpisodes<T extends ToolEpisodeCollection>(
  state: T,
  event: SessionEvent,
  excludedTools: ReadonlySet<string> = new Set(),
): T {
  if (event.type === 'assistant/message') {
    return { ...state, assistants: { ...state.assistants, [String(event.data.step)]: { text: explanation(event), seq: Number(event.seq) } } }
  }
  if (event.type === 'tool/call') {
    if (excludedTools.has(event.data.name)) return state
    const callId = String(event.data.callId)
    return { ...state, calls: { ...state.calls, [callId]: {
      step: event.data.step, tool: event.data.name, arguments: event.data.arguments, seq: Number(event.seq),
    } } }
  }
  if (event.type === 'tool/result') {
    const callId = String(event.data.message.content[0].toolCallId)
    if (state.calls[callId] === undefined) return state
    const block = event.data.message.content[0]
    return { ...state, results: { ...state.results, [callId]: {
      result: contentText(block.content), isError: block.isError === true, seq: Number(event.seq),
    } } }
  }
  if (event.type !== 'step/end') return state
  const stepCalls = Object.entries(state.calls).filter(([callId, call]) => call.step === event.data.step && state.results[callId] !== undefined)
  if (stepCalls.length === 0) return state
  const assistant = state.assistants[String(event.data.step)]
  const interaction: ToolEpisode = {
    id: state.interactions.length,
    agentStep: event.data.step,
    explanation: assistant?.text ?? '',
    actions: stepCalls.map(([callId, call]) => ({
      tool: call.tool, arguments: call.arguments, result: state.results[callId]?.result ?? '', isError: state.results[callId]?.isError ?? true,
    })),
    relatedSeqs: [...new Set([
      ...(assistant === undefined ? [] : [assistant.seq]),
      ...stepCalls.flatMap(([callId, call]) => [call.seq, state.results[callId]?.seq].filter((seq): seq is number => seq !== undefined)),
    ])].sort((left, right) => left - right),
  }
  const assistants = { ...state.assistants }
  delete assistants[String(event.data.step)]
  const calls = Object.fromEntries(Object.entries(state.calls).filter(([, call]) => call.step !== event.data.step))
  const stepCallIds = new Set(stepCalls.map(([callId]) => callId))
  const results = Object.fromEntries(Object.entries(state.results).filter(([callId]) => !stepCallIds.has(callId)))
  return { ...state, interactions: [...state.interactions, interaction], assistants, calls, results }
}
