import { describe, expect, it } from 'vitest'
import { HARNESS_CATALOG, harnessById } from '../src/catalog.js'

describe('Harness catalogue', () => {
  it('contains the thirteen distinct Table 1 targets', () => {
    expect(HARNESS_CATALOG).toHaveLength(13)
    expect(new Set(HARNESS_CATALOG.map(entry => entry.id)).size).toBe(13)
  })

  it('separates coordinator-owned runs from in-loop adaptations', () => {
    expect(HARNESS_CATALOG.filter(entry => entry.family === 'coordinator').map(entry => entry.id))
      .toEqual(['aggagent', 'oagent', 'roma', 'aorchestra'])
  })

  it('resolves definitions by stable id', () => {
    expect(harnessById('memobrain').displayName).toBe('MemoBrain')
  })
})
