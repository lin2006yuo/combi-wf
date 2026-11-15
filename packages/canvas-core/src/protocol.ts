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
  /** 包含 applied 与 undone；discarded 不下发 */
  history: HistoryEntry[]
  runtime: Record<string, NodeRuntime>
}

export interface AppliedMessage {
  type: 'applied'
  requestId?: string
  commandId: string
  rev: number
  patch: Patch[]
  entry?: HistoryEntry
  /** undo/redo 时带完整历史；普通命令由客户端 append */
  history?: HistoryEntry[]
  /** 新命令截断 redo 分支时，被丢弃的 entry id */
  discarded?: string[]
  undone?: string
  redone?: string
  changed: boolean
  affected: { nodes: string[]; edges: string[] }
  created: { nodes: string[]; edges: string[] }
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
