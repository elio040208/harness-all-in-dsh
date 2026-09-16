import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import Session from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as HarnessPlugin from '../src/index.js'
import { RESUM_PROMPT } from '../src/index.js'

describe('ReSum Harness', () => {
  it('contributes the ReSum continuation policy through the DSH prompt registry', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, {})
      await ctx.plugin(Tools, {})
      await ctx.plugin(Session)
      await ctx.plugin(SessionProjection)
      await ctx.plugin(HarnessPlugin, { harness: 'resum' })

      const rendered = renderPrompt(await ctx.systemPrompt.assemble())
      expect(rendered).toContain(RESUM_PROMPT)
      expect(rendered).toContain('automatic ReSum checkpoints')
      expect(rendered).not.toContain('submit_plan')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('enables a whole-history compaction at ninety percent pressure', () => {
    const profile = readFileSync(
      new URL('../profiles/resum.cordis.patch.yml', import.meta.url),
      'utf8',
    )
    expect(profile).toContain('harness: resum')
    expect(profile).toContain('thresholdRatio: 0.9')
    expect(profile).toContain('retainTokens: 0')
    expect(profile).toContain('compactionRetries: 0')
  })
})
