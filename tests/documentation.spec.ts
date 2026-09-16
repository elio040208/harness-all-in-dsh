import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const englishDocuments = [
  'README.md',
  'docs/architecture.md',
  'research/SOURCES.md',
  'research/agentfold.md',
  'research/aggagent.md',
  'research/aorchestra.md',
  'research/deepagent.md',
  'research/flash-searcher.md',
  'research/gam.md',
  'research/hiagent.md',
  'research/memobrain.md',
  'research/oagent.md',
  'research/plan-and-execute.md',
  'research/react.md',
  'research/resum.md',
  'research/roma.md',
] as const

function chinesePath(englishPath: string): string {
  return englishPath.replace(/\.md$/, '.zh.md')
}

function markdownPath(from: string, to: string): string {
  return relative(from, to).replaceAll('\\', '/')
}

function headings(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter(line => /^#{1,3} /.test(line))
    .map(line => line.match(/^#+/)?.[0] ?? '')
}

function fencedBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```[^\n]*\n[\s\S]*?```/g)].map(match => match[0])
}

describe('Documentation', () => {
  it.each(englishDocuments)('keeps %s paired with Chinese', englishPath => {
    const localizedPath = chinesePath(englishPath)
    expect(existsSync(join(root, localizedPath)), `${localizedPath} is missing`).toBe(true)

    const english = readFileSync(join(root, englishPath), 'utf8')
    const chinese = readFileSync(join(root, localizedPath), 'utf8')
    expect(english).toContain(`[中文](${markdownPath(dirname(englishPath), localizedPath)})`)
    expect(chinese).toContain(`[English](${markdownPath(dirname(localizedPath), englishPath)})`)
    expect(headings(chinese)).toEqual(headings(english))
    expect(fencedBlocks(chinese)).toEqual(fencedBlocks(english))
  })

  it('does not tie the catalogue to a numbered paper table', () => {
    for (const englishPath of englishDocuments) {
      const paths = [englishPath, chinesePath(englishPath)]
      for (const path of paths) {
        expect(readFileSync(join(root, path), 'utf8')).not.toMatch(/table\s*1|table one/i)
      }
    }
  })
})
