import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRomaAtomizer, parseRomaPlan } from '../src/index.js'

describe('ROMA Harness', () => {
  it('parses strict atomizer decisions', () => {
    expect(parseRomaAtomizer('{"is_atomic":false,"node_type":"PLAN"}')).toEqual({
      isAtomic: false, nodeType: 'plan',
    })
    expect(() => parseRomaAtomizer('{"is_atomic":"no","node_type":"PLAN"}')).toThrow('is_atomic')
    expect(() => parseRomaAtomizer('{"is_atomic":true,"node_type":"OTHER"}')).toThrow('node_type')
  })

  it('accepts a dependency DAG and rejects cycles', () => {
    const plan = parseRomaPlan(JSON.stringify({ subtasks: [
      { id: 'facts', goal: 'Collect facts', task_type: 'RETRIEVE', depends_on: [] },
      { id: 'answer', goal: 'Synthesize facts', task_type: 'WRITE', depends_on: ['facts'] },
    ] }), 4)
    expect(plan.map(task => [task.id, task.taskType])).toEqual([['facts', 'RETRIEVE'], ['answer', 'WRITE']])
    expect(() => parseRomaPlan(JSON.stringify({ subtasks: [
      { id: 'a', goal: 'A', task_type: 'THINK', depends_on: ['b'] },
      { id: 'b', goal: 'B', task_type: 'THINK', depends_on: ['a'] },
    ] }), 4)).toThrow()
    expect(() => parseRomaPlan(JSON.stringify({ subtasks: [
      { id: 'code', goal: 'Run code', task_type: 'CODE', depends_on: [] },
    ] }), 4)).toThrow('task_type must be one of')
  })

  it('configures one coordinator action and bounded recursion', () => {
    const profile = readFileSync(new URL('../profiles/roma.cordis.patch.yml', import.meta.url), 'utf8')
    expect(profile).toContain('harness: roma')
    expect(profile).toContain('romaMaxDepth: 2')
    expect(profile).toContain('maxParallelToolCalls: 1')
  })
})
