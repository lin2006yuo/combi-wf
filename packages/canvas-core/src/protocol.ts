import type { Patch } from 'immer'
import type { Command } from './commands'
import type { HistoryEntry } from './history'
import type { CanvasDoc, NodeRuntime } from './types'

/** WebSocket 下行消息。执行面（runtime）和文档面（patch）严格分开。 */
export type ServerMessage =
  | SnapshotMessage
  | AppliedMessage
  | CommandResultMessage
  | CommandErrorMessage
  | RuntimeMessage
  | ToastMessage

export interface SnapshotMessage {
  type: 'snapshot'
  doc: CanvasDoc
  history: HistoryEntry[]
  cursor: number
  runtime: Record<string, NodeRuntime>
}

export interface AppliedMessage {
  type: 'applied'
  requestId?: string
  commandId: string
  rev: number
  patch: Patch[]
  entry?: HistoryEntry
  /** 只有 undo/redo 会带完整历史；普通命令由客户端 append。 */
  history?: HistoryEntry[]
  cursor: number
  changed: boolean
  affected: { nodes: string[]; edges: string[] }
  created: { nodes: string[]; edges: string[] }
  undone?: string
  redone?: string
}

export interface CommandResultMessage {
  type: 'command.result'
  requestId?: string
  data: unknown
}

export interface CommandErrorMessage {
  type: 'command.error'
  requestId?: string
  error: { code: string; message: string }
}

export interface RuntimeMessage {
  type: 'runtime'
  nodeId: string
  runtime: NodeRuntime | null
}

export interface ToastMessage {
  type: 'toast'
  level: 'info' | 'warn' | 'error'
  message: string
}

/** WebSocket 上行消息。 */
export type ClientMessage =
  | { type: 'command'; requestId: string; command: Command }
  | { type: 'resync' }
  | { type: 'ping' }
