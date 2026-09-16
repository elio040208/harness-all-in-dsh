import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

/** Result of one model call made by a Harness management component. */
export interface AuxiliaryTextResult {
  readonly provider: string
  readonly model: string
  readonly text: string
}

/** Run one text-only auxiliary call through the conversation's current route. */
export async function auxiliaryText(
  ctx: Context,
  agent: Agent,
  system: string,
  prompt: string,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<AuxiliaryTextResult> {
  const routed = agent.session.requestHeader()?.config
  const provider = routed?.provider ?? agent.options.provider
  const model = routed?.model ?? agent.options.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    throw new Error('no routed provider/model is available for the auxiliary Harness call')
  }
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({
    provider,
    model,
    system,
    messages: [createUserMessage({
      source: { kind: 'plugin', plugin: 'harness-all-in-dsh' },
      content: [{ type: 'text', text: prompt }],
    })],
    maxTokens,
    sessionId: agent.session.id,
    ...(signal === undefined ? {} : { signal }),
  })) assembler.push(chunk)
  switch (assembler.finish.kind) {
    case 'stop':
    case 'tool-calls':
      break
    case 'max-tokens':
      throw new Error('auxiliary Harness call reached its output token cap')
    case 'error':
    case 'aborted':
      throw new Error(assembler.finish.failure.message)
    default:
      throw new Error('auxiliary Harness call ended with an unsupported finish reason')
  }
  const text = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('').trim()
  if (text.length === 0) throw new Error('auxiliary Harness call produced no text')
  return { provider, model, text }
}
