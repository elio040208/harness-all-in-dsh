import { Context } from '@deepseek-ai/cordis'
import { agentEvents, assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { installHarnessProtocol } from '../src/runtime/protocol.js'

const signal = new AbortController().signal

function tool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
    execute: () => Promise.resolve(`ran:${name}`),
  }
}

async function execute(ctx: Context, agent: Agent, name: string): Promise<string> {
  const result = await ctx.tools.execute({ signal, callId: ToolCallId(`call-${name}`), name, arguments: {}, agent })
  const content = result.content[0]
  return content?.type === 'text' ? content.text : ''
}

describe('Harness response protocol', () => {
  it('freezes one phase across every tool call from a model response', async () => {
    const ctx = new Context()
    const agent = { id: 'protocol-agent' as SessionId } as Agent
    let phase = 'work'
    try {
      await ctx.plugin(SystemPrompt, {})
      await ctx.plugin(ToolRuntime)
      ctx.tools.register(tool('task_one'))
      ctx.tools.register(tool('task_two'))
      ctx.tools.register(tool('maintain'))
      const handle = installHarnessProtocol(ctx, {
        id: 'test',
        resolve: () => phase === 'work'
          ? { id: 'work', context: 'Work phase.', allowedTools: new Set(['task_one', 'task_two']), denial: 'Task phase only.' }
          : { id: 'maintain', context: 'Maintenance phase.', allowedTools: new Set(['maintain']), denial: 'Maintenance is required.' },
      })

      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(assembly.tools.map(tool => tool.name)).toEqual(['task_one', 'task_two'])
      expect(renderContextSnapshot(assembly)).toContain('Work phase.')
      await agentEvents(ctx, agent).waterfall('agent/pre-step', {
        messages: [], turn: 1, step: 1, signal,
      }, () => Promise.resolve({ kind: 'enter', messages: [] }))

      phase = 'maintain'
      expect(handle.active(agent)?.id).toBe('work')
      expect(await execute(ctx, agent, 'task_one')).toBe('ran:task_one')
      expect(await execute(ctx, agent, 'task_two')).toBe('ran:task_two')
      expect(await execute(ctx, agent, 'maintain')).toBe('Error: Task phase only.')

      const nextAssembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
      expect(nextAssembly.tools.map(tool => tool.name)).toEqual(['maintain'])
      expect(renderContextSnapshot(nextAssembly)).toContain('Maintenance phase.')
      await agentEvents(ctx, agent).waterfall('agent/pre-step', {
        messages: [], turn: 1, step: 2, signal,
      }, () => Promise.resolve({ kind: 'enter', messages: [] }))
      expect(handle.active(agent)?.id).toBe('maintain')
      expect(await execute(ctx, agent, 'task_one')).toBe('Error: Maintenance is required.')
      expect(await execute(ctx, agent, 'maintain')).toBe('ran:maintain')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
