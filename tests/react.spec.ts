import { Context } from '@deepseek-ai/cordis'
import Session from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as HarnessPlugin from '../src/index.js'
import { REACT_PROMPT } from '../src/index.js'

describe('ReAct Harness', () => {
  it('contributes the ReAct policy through the DSH system-prompt registry', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, {})
      await ctx.plugin(Tools, {})
      await ctx.plugin(Session)
      await ctx.plugin(SessionProjection)
      await ctx.plugin(HarnessPlugin, { harness: 'react' })

      const rendered = renderPrompt(await ctx.systemPrompt.assemble())
      expect(rendered).toContain(REACT_PROMPT)
      expect(rendered).toContain('reasoning, action, and observation')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
