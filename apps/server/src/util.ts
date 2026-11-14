import { createHash, randomUUID } from 'node:crypto'
import { CanvasError } from '@combi/canvas-core'

export function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`
}

export function sanitizeDocId(value: string | undefined | null): string {
  const id = value ?? 'main'
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new CanvasError('INVALID_COMMAND', `非法文档 id：${id}`)
  }
  return id
}

/** JSON.stringify 的确定性版本，用于计算输入签名。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key])
    }
    return sorted
  }
  return value
}
