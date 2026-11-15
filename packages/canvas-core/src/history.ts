import type { Patch } from 'immer'
import type { Source } from './types'

export type HistoryStatus = 'applied' | 'undone' | 'discarded'

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
  /**
   * applied：当前生效
   * undone：已撤销、可重做
   * discarded：撤销后被新操作截断，不再出现在历史里
   */
  status: HistoryStatus
}
