import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { aorchestraToolCatalogue, aorchestraTraceSummary, renderAOrchestraContext, trajectoryFinalAnswer } from '../src/index.js'
import type { AgentTrajectory, AOrchestraConfig } from '../src/index.js'

const trajectory: AgentTrajectory = {
  id: 1,
  sessionId: 'child-1',
  stopReason: 'completed',
  steps: [
    { role: 'assistant', content: 'working' },
    { role: 'tool', toolName: 'bash', content: 'AORCHESTRA_FACT' },
    { role: 'assistant', content: 'final result' },
    { role: 'tool', toolName: 'late-observer', content: 'presentation metadata' },
  ],
}

describe('AOrchestra Harness', () => {
  it('uses the last non-empty assistant message as the child result', () => {
    expect(trajectoryFinalAnswer(trajectory)).toBe('final result')
  })

  it('summarizes bounded tool evidence for the orchestrator', () => {
    expect(aorchestraTraceSummary(trajectory)).toEqual([
      'bash: AORCHESTRA_FACT', 'late-observer: presentation metadata',
    ])
  })

  it('configures an explicit model set and delegation budget', () => {
    const profile = readFileSync(new URL('../profiles/aorchestra.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: aorchestra')
    expect(profile).toContain('aorchestraModels: deepseek-v4.1-flash')
    expect(profile).toContain('aorchestraMaxDelegations: 5')

    const config: AOrchestraConfig = {
      subagentProvider: 'spawn', modelProvider: '', models: ['deepseek-v4.1-flash'],
      maxDelegations: 5, controllerReminderLimit: 2,
    }
    expect(renderAOrchestraContext(2, config, '- bash: run commands'))
      .toContain('Delegation budget: 2/5 used')
  })

  it('builds child capabilities from the registry rather than the filtered parent request', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, {})
      await ctx.plugin(ToolRuntime)
      for (const name of ['bash', 'aorchestra_delegate', 'aorchestra_complete']) ctx.tools.register({
        name, description: name, parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'string' }, render: () => [] },
        execute: () => Promise.resolve(name),
      })
      const agent = { id: 'parent' as SessionId } as Agent
      expect(aorchestraToolCatalogue(ctx, agent).map(tool => tool.name)).toEqual(['bash'])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
