import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { contentText } from './content.js'
import { isHarnessProtocolDenialResult } from './protocol.js'

const SOURCE = 'harness-all-in-dsh:execution-discipline'
const MARKER = 'Failure pattern: '

/** One repeated operational failure that should prompt a strategy change. */
export interface ExecutionAdvisory {
  readonly tool: string
  readonly signature: string
  readonly count: number
}

/** Collapse recoverable infrastructure failures into stable strategy-level signatures. */
export function recoverableFailureSignature(text: string): string | undefined {
  const normalized = text.toLocaleLowerCase()
  if (normalized.includes('web fetch failed')) return 'web fetch failed'
  if (normalized.includes('tool call timed out')) return 'tool call timed out'
  if (normalized.includes('cross-origin redirect')) return 'cross-origin redirect'
  if (normalized.includes('unsupported content type')) return 'unsupported content type'
  if (/\b(?:econnreset|econnrefused|etimedout|enotfound)\b/u.test(normalized)) return 'network connection failed'
  return undefined
}

function key(advisory: Pick<ExecutionAdvisory, 'tool' | 'signature'>): string {
  return JSON.stringify({ tool: advisory.tool, signature: advisory.signature })
}

function recordedAdvisories(events: readonly SessionEvent[]): Set<string> {
  return new Set(events.flatMap(event => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'plugin' || event.data.source.plugin !== SOURCE) return []
    const line = contentText(event.data.content).split('\n').find(candidate => candidate.startsWith(MARKER))
    return line === undefined ? [] : [line.slice(MARKER.length)]
  }))
}

/** Find the next unreported repeated failure without changing tool admission. */
export function nextExecutionAdvisory(events: readonly SessionEvent[]): ExecutionAdvisory | undefined {
  const calls = new Map<string, string>()
  const counts = new Map<string, ExecutionAdvisory>()
  const recorded = recordedAdvisories(events)
  for (const event of events) {
    if (event.type === 'tool/call') {
      calls.set(String(event.data.callId), event.data.name)
      continue
    }
    if (event.type !== 'tool/result' || event.data.message.content[0].isError !== true || isHarnessProtocolDenialResult(event)) continue
    const block = event.data.message.content[0]
    const tool = calls.get(String(block.toolCallId))
    const signature = recoverableFailureSignature(contentText(block.content))
    if (tool === undefined || signature === undefined) continue
    const advisoryKey = key({ tool, signature })
    const previous = counts.get(advisoryKey)
    counts.set(advisoryKey, { tool, signature, count: (previous?.count ?? 0) + 1 })
  }
  return [...counts.values()].find(advisory => advisory.count >= 2 && !recorded.has(key(advisory)))
}

function advisoryText(advisory: ExecutionAdvisory): string {
  return `Repeated operational failure: ${advisory.tool} returned “${advisory.signature}” ${advisory.count} times. Change tool, source, query, or strategy; if existing evidence already satisfies the task, finish now. This is advisory: every tool remains available.\n${MARKER}${key(advisory)}`
}

/** Install replayable next-step advice after repeated recoverable tool failures. */
export function installExecutionDiscipline(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const advisory = nextExecutionAdvisory(agent.session.snapshotEvents())
    if (advisory !== undefined) {
      agent.session.append('user/message', createUserMessage({
        source: { kind: 'plugin', plugin: SOURCE },
        content: [{ type: 'text', text: advisoryText(advisory) }],
      }), { surfaceOp: 'append' })
    }
    return await next()
  })
}
