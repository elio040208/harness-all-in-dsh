/** Convert nested DSH content blocks and JSON values to replay-safe text. */
export function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n')
  if (typeof value !== 'object' || value === null) return String(value ?? '')
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if ('content' in record) return contentText(record.content)
  return JSON.stringify(value)
}
