import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HARNESS_CATALOG } from '../src/catalog.js'

const root = join(import.meta.dirname, '..')
const presetRoot = join(root, 'presets')
const cadenceHarnesses = new Set(['plan-and-execute', 'flash-searcher', 'gam'])

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('Web Agent presets', () => {
  it('publishes one selectable preset for every implemented Harness', () => {
    const expected = HARNESS_CATALOG.map(entry => `harness-${entry.id}`).sort()
    const actual = readdirSync(presetRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
      .map(entry => entry.name)
      .sort()

    expect(actual).toEqual(expected)
    for (const entry of HARNESS_CATALOG) {
      const directory = `presets/harness-${entry.id}`
      const composition = read(`${directory}/agent.cordis.yml`)
      const metadata = read(`${directory}/preset.yml`)
      expect(composition).toContain('name: cordis:include')
      expect(composition).toContain('path: ../_shared/agent-tools.cordis.yml')
      expect(composition).toContain('name: harness-all-in-dsh')
      expect(composition).toContain(`harness: ${entry.id}`)
      if (cadenceHarnesses.has(entry.id)) expect(composition).toContain('protocolMode: guided')
      expect(metadata).toMatch(/^name: Harness · /m)
      expect(metadata).toMatch(/^description: \S/m)
      expect(metadata).toMatch(/^order: 1\d\d$/m)
    }
  })

  it('registers the packaged preset root without changing Web loop concurrency', () => {
    const bundle = read('cordis.patch.yml')
    expect(bundle).toContain('- id: agent-presets')
    expect(bundle).toContain('default: standard')
    expect(bundle).toContain("ctx.get('pluginPackages').packageOf('harness-all-in-dsh', baseUrl).dir")
    expect(bundle).not.toContain('maxParallelToolCalls')
    expect(bundle).not.toContain('name: harness-all-in-dsh')
    expect(read('package.json')).toContain('"presets/**/*"')
  })

  it('keeps headless overlays self-contained', () => {
    for (const entry of HARNESS_CATALOG) {
      const overlay = read(`profiles/${entry.id}.cordis.patch.yml`)
      expect(overlay).toContain('- insert:')
      expect(overlay).toContain('name: harness-all-in-dsh')
      expect(overlay).toContain(`harness: ${entry.id}`)
      expect(overlay).toContain('maxParallelToolCalls:')
      if (cadenceHarnesses.has(entry.id)) expect(overlay).toContain('protocolMode: strict')
    }
  })
})
