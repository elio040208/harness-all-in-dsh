import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import { registerHarnessContext, registerHarnessPrompt } from '../src/runtime/prompt.js'

describe('Harness prompt registration', () => {
  it('keeps policy stable while runtime state changes', async () => {
    const ctx = new Context()
    let state = 'initial state'
    try {
      await ctx.plugin(SystemPrompt, {})
      registerHarnessPrompt(ctx, { id: 'test', text: 'Stable policy.' })
      registerHarnessContext(ctx, { id: 'test', text: () => state })

      const initial = await ctx.systemPrompt.assemble()
      state = 'updated state'
      const updated = await ctx.systemPrompt.assemble()

      expect(renderPrompt(initial)).toBe(renderPrompt(updated))
      expect(renderContextSnapshot(initial)).toContain('initial state')
      expect(renderContextSnapshot(updated)).toContain('updated state')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
