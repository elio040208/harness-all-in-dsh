import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { contentText } from './content.js'
import { isHarnessProtocolDenialResult } from './protocol.js'

/** One searchable message or tool interaction in an isolated Agent trajectory. */
export interface TrajectoryStep {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly toolCalls?: readonly { readonly name: string; readonly arguments: string }[]
  readonly toolName?: string
}

/** One isolated rollout captured from its durable child Session. */
export interface AgentTrajectory {
  readonly id: number
  readonly sessionId: string
  readonly stopReason: string
  readonly steps: readonly TrajectoryStep[]
}

/** Return the last non-empty assistant message produced by one trajectory. */
export function trajectoryFinalAnswer(trajectory: AgentTrajectory): string {
  return trajectory.steps.findLast(step => step.role === 'assistant' && step.content.trim().length > 0)?.content.trim() ?? ''
}

type MutableStep = {
  role: TrajectoryStep['role']
  content: string
  toolCalls?: { name: string; arguments: string }[]
  toolName?: string
  agentStep?: number
}

/** Convert DSH Session events into the message-oriented trajectory used by aggregation Harnesses. */
export function trajectoryFromEvents(
  id: number,
  sessionId: string,
  stopReason: string,
  events: readonly SessionEvent[],
): AgentTrajectory {
  const steps: MutableStep[] = []
  const pendingTools = new Map<string, { readonly name: string; readonly call: { readonly name: string; readonly arguments: string }; readonly step: number }>()
  for (const event of events) {
    switch (event.type) {
      case 'system/message':
        steps.push({ role: 'system', content: contentText(event.data.message.content), agentStep: event.data.step })
        break
      case 'user/message':
        steps.push({ role: 'user', content: contentText(event.data.content) })
        break
      case 'assistant/message':
        steps.push({ role: 'assistant', content: contentText(event.data.message.content), agentStep: event.data.step })
        break
      case 'tool/call': {
        const assistant = steps.findLast(step => step.role === 'assistant' && step.agentStep === event.data.step)
        const call = { name: event.data.name, arguments: event.data.arguments }
        pendingTools.set(String(event.data.callId), { name: event.data.name, call, step: event.data.step })
        if (assistant === undefined) steps.push({ role: 'assistant', content: '', toolCalls: [call], agentStep: event.data.step })
        else assistant.toolCalls = [...(assistant.toolCalls ?? []), call]
        break
      }
      case 'tool/result': {
        const block = event.data.message.content[0]
        const callId = String(block.toolCallId)
        const pending = pendingTools.get(callId)
        if (isHarnessProtocolDenialResult(event)) {
          const assistantIndex = steps.findLastIndex(step => step.role === 'assistant' && step.agentStep === pending?.step)
          const assistant = steps[assistantIndex]
          if (assistant?.toolCalls !== undefined) {
            const remaining = assistant.toolCalls.filter(call => call !== pending?.call)
            if (remaining.length === 0) delete assistant.toolCalls
            else assistant.toolCalls = remaining
          }
          if (assistant?.content.length === 0 && assistant.toolCalls === undefined) steps.splice(assistantIndex, 1)
          pendingTools.delete(callId)
          break
        }
        steps.push({
          role: 'tool',
          content: contentText(block.content),
          ...(pending === undefined ? {} : { toolName: pending.name }),
          agentStep: event.data.step,
        })
        pendingTools.delete(callId)
        break
      }
      default:
        break
    }
  }
  return {
    id,
    sessionId,
    stopReason,
    steps: steps.map(({ agentStep: _agentStep, ...step }) => step),
  }
}

function tokens(text: string): string[] {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}_]+|[^\s]/gu) ?? []
}

/** ROUGE-L recall, matching AggAgent's query-token recall ranking. */
export function rougeLRecall(query: string, text: string): number {
  const queryTokens = tokens(query)
  const textTokens = tokens(text)
  if (queryTokens.length === 0 || textTokens.length === 0) return 0
  let previous = new Array<number>(textTokens.length + 1).fill(0)
  for (const queryToken of queryTokens) {
    const current = new Array<number>(textTokens.length + 1).fill(0)
    for (let index = 1; index <= textTokens.length; index += 1) {
      current[index] = queryToken === textTokens[index - 1]
        ? (previous[index - 1] ?? 0) + 1
        : Math.max(previous[index] ?? 0, current[index - 1] ?? 0)
    }
    previous = current
  }
  return (previous[textTokens.length] ?? 0) / queryTokens.length
}

/** Truncate text after a fixed number of whitespace-delimited words. */
export function truncateWords(text: string, maximum: number): string {
  const matches = [...text.matchAll(/\S+/gu)]
  const cutoff = matches[maximum - 1]
  if (cutoff === undefined || matches.length <= maximum) return text
  return `${text.slice(0, (cutoff.index ?? 0) + cutoff[0].length)}\n[... truncated]`
}

/** Render the compact trajectory catalogue supplied to an aggregation model. */
export function formatTrajectoryMetadata(trajectories: readonly AgentTrajectory[]): string {
  return trajectories.map(trajectory => {
    const counts = new Map<string, number>()
    for (const step of trajectory.steps) {
      for (const call of step.toolCalls ?? []) counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
    }
    const tools = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => `${name}×${count}`).join(', ') || 'none'
    const chars = trajectory.steps.reduce((total, step) => total + step.role.length + step.content.length
      + JSON.stringify(step.toolCalls ?? []).length, 0)
    return `Trajectory ${trajectory.id}: ${trajectory.steps.length} steps, ~${Math.floor(chars / 4).toLocaleString('en-US')} tokens | tools: ${tools} | stop: ${trajectory.stopReason}`
  }).join('\n\n')
}

/** Return the final message content from selected trajectories. */
export function trajectorySolutions(
  trajectories: readonly AgentTrajectory[],
  trajectoryId?: number,
): readonly { readonly trajectoryId: number; readonly content: string }[] {
  const selected = trajectoryId === undefined
    ? trajectories
    : trajectories.filter(trajectory => trajectory.id === trajectoryId)
  if (trajectoryId !== undefined && selected.length === 0) throw new Error(`trajectoryId must be 1-${trajectories.length}`)
  return selected.map(trajectory => ({
    trajectoryId: trajectory.id,
    content: trajectoryFinalAnswer(trajectory),
  }))
}

/** Search one trajectory by ROUGE-L recall over content and tool calls. */
export function searchTrajectory(
  trajectory: AgentTrajectory,
  query: string,
  role?: 'tool' | 'assistant',
  maximum = 5,
): readonly (TrajectoryStep & { readonly step: number; readonly score: number })[] {
  return trajectory.steps.map((step, index) => {
    const toolCalls = JSON.stringify(step.toolCalls ?? [])
    return { ...step, step: index + 1, score: Math.max(rougeLRecall(query, step.content), rougeLRecall(query, toolCalls)) }
  }).filter(step => (role === undefined || step.role === role) && step.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.min(Math.max(maximum, 1), 10))
    .map(step => ({ ...step, content: truncateWords(step.content, 150), score: Math.round(step.score * 1000) / 1000 }))
}

/** Read a clamped contiguous trajectory segment of at most five steps. */
export function trajectorySegment(
  trajectory: AgentTrajectory,
  startStep: number,
  endStep: number,
): readonly (TrajectoryStep & { readonly step: number })[] {
  if (trajectory.steps.length === 0) return []
  const start = Math.max(1, Math.min(startStep, trajectory.steps.length))
  const requestedEnd = Math.max(1, Math.min(endStep, trajectory.steps.length))
  const end = Math.min(Math.max(start, requestedEnd), start + 4)
  return trajectory.steps.slice(start - 1, end).map((step, index) => ({
    ...step,
    step: start + index,
    content: truncateWords(step.content, 600),
  }))
}
