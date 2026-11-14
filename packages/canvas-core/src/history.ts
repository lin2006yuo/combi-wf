import type { Patch } from 'immer'
import type { Source } from './types'

export interface HistoryEntry {
  id: string
  seq: number
  docId: string
  type: string
  source: Source
  actorId?: string
  /** 历史面板文案，例如「移动 2 个节点」 */
  label: string
  forward: Patch[]
  inverse: Patch[]
  nodes: string[]
  edges: string[]
  ts: number
}

export interface HistoryState {
  entries: HistoryEntry[]
  cursor: number
}
