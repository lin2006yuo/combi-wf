import { applyPatches, type Patch } from 'immer'
import { applyDocumentCommand } from './apply'
import type { DocumentCommand } from './commands'
import { CanvasError } from './errors'
import type { HistoryEntry } from './history'
import type { NodeRegistry } from './registry/registry'
import type { CanvasDoc, Source } from './types'

export interface CommandLogOptions {
  doc: CanvasDoc
  registry: NodeRegistry
  entries?: HistoryEntry[]
  seq?: number
  now?: () => number
}

export interface LogResult {
  commandId: string
  rev: number
  patch: Patch[]
  changed: boolean
  entry?: HistoryEntry
  /** undo / redo 时返回完整可见历史 */
  history?: HistoryEntry[]
  /** 新命令截断 redo 分支时，被丢弃的 entry id */
  discarded?: string[]
  undone?: string
  redone?: string
  affected: { nodes: string[]; edges: string[] }
  created: { nodes: string[]; edges: string[] }
}

let counter = 0

function newId(prefix: string): string {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (maybeCrypto?.randomUUID) return `${prefix}_${maybeCrypto.randomUUID().slice(0, 8)}`
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`
}

/**
 * 文档 + 追加式历史。
 *
 * - 服务端用它作为权威状态和 change log。
 * - 客户端不直接用它；客户端从 snapshot / applied 消息构建自己的 undo stack。
 * - 撤销/重做只允许 LIFO；客户端可以决定 cursor，但服务端校验栈顶。
 */
export class CommandLog {
  private doc: CanvasDoc
  private entries: HistoryEntry[]
  private seq: number
  private readonly registry: NodeRegistry
  private readonly now: () => number

  constructor(options: CommandLogOptions) {
    this.doc = options.doc
    this.registry = options.registry
    this.entries = options.entries ?? []
    this.seq = options.seq ?? this.entries.reduce((max, entry) => Math.max(max, entry.seq), 0)
    this.now = options.now ?? (() => Date.now())
  }

  getDoc(): CanvasDoc {
    return this.doc
  }

  /** 客户端可见历史：discarded 不返回，undone 保留供重做 */
  getHistory(): HistoryEntry[] {
    return this.entries.filter((entry) => entry.status !== 'discarded')
  }

  getAppliedCount(): number {
    return this.entries.filter((entry) => entry.status === 'applied').length
  }

  getTopApplied(): HistoryEntry | undefined {
    return [...this.entries].reverse().find((entry) => entry.status === 'applied')
  }

  getFirstUndone(): HistoryEntry | undefined {
    return this.entries.find((entry) => entry.status === 'undone')
  }

  getEntry(id: string): HistoryEntry | undefined {
    return this.entries.find((entry) => entry.id === id)
  }

  apply(command: DocumentCommand): LogResult {
    const id = command.id ?? newId('c')
    const ts = command.ts ?? this.now()
    const source = command.source ?? 'user'
    const actorId = command.actorId

    const result = applyDocumentCommand(
      this.doc,
      { ...command, id },
      this.registry,
    )

    if (result.patches.length === 0) {
      return {
        commandId: id,
        rev: this.doc.rev,
        patch: [],
        changed: false,
        affected: { nodes: [], edges: [] },
        created: { nodes: [], edges: [] },
      }
    }

    const discarded: string[] = []
    for (const entry of this.entries) {
      if (entry.status === 'undone') {
        entry.status = 'discarded'
        discarded.push(entry.id)
      }
    }

    this.seq += 1
    const entry: HistoryEntry = {
      id,
      seq: this.seq,
      docId: this.doc.id,
      type: command.type,
      source,
      actorId,
      label: command.label ?? result.outcome.label,
      forward: result.patches,
      inverse: result.inverse,
      nodes: [...new Set(result.outcome.nodes)],
      edges: [...new Set(result.outcome.edges)],
      ts,
      status: 'applied',
    }
    this.entries.push(entry)
    this.doc = { ...result.doc, rev: this.doc.rev + 1 }

    return {
      commandId: id,
      rev: this.doc.rev,
      patch: result.patches,
      changed: true,
      entry,
      discarded: discarded.length > 0 ? discarded : undefined,
      affected: { nodes: entry.nodes, edges: entry.edges },
      created: {
        nodes: [...new Set(result.outcome.createdNodes)],
        edges: [...new Set(result.outcome.createdEdges)],
      },
    }
  }

  undo(entryId?: string): LogResult {
    const target = entryId ? this.getEntry(entryId) : this.getTopApplied()
    if (!target) throw new CanvasError('NOTHING_TO_UNDO', '没有可撤销的操作')
    if (target.status !== 'applied') {
      throw new CanvasError('ENTRY_NOT_UNDOABLE', '这条历史已经撤销或失效')
    }
    const top = this.getTopApplied()
    if (!top || top.id !== target.id) {
      throw new CanvasError(
        'OUT_OF_ORDER_UNDO',
        '只能撤销栈顶操作；请先撤销更新的操作',
        { target: target.id, top: top?.id },
      )
    }

    this.doc = { ...applyPatches(this.doc, target.inverse), rev: this.doc.rev + 1 }
    target.status = 'undone'

    return {
      commandId: newId('undo'),
      rev: this.doc.rev,
      patch: target.inverse,
      changed: true,
      history: this.getHistory(),
      undone: target.id,
      affected: { nodes: target.nodes, edges: target.edges },
      created: { nodes: [], edges: [] },
    }
  }

  redo(entryId?: string): LogResult {
    const target = entryId ? this.getEntry(entryId) : this.getFirstUndone()
    if (!target) throw new CanvasError('NOTHING_TO_REDO', '没有可重做的操作')
    if (target.status !== 'undone') {
      throw new CanvasError('ENTRY_NOT_REDOABLE', '这条历史不可重做')
    }
    const first = this.getFirstUndone()
    if (!first || first.id !== target.id) {
      throw new CanvasError(
        'OUT_OF_ORDER_REDO',
        '只能按顺序重做；请先重做更早的操作',
        { target: target.id, first: first?.id },
      )
    }

    this.doc = { ...applyPatches(this.doc, target.forward), rev: this.doc.rev + 1 }
    target.status = 'applied'

    return {
      commandId: newId('redo'),
      rev: this.doc.rev,
      patch: target.forward,
      changed: true,
      history: this.getHistory(),
      redone: target.id,
      affected: { nodes: target.nodes, edges: target.edges },
      created: { nodes: [], edges: [] },
    }
  }

  toSnapshot(): CommandLogSnapshot {
    return {
      doc: this.doc,
      entries: this.getHistory(),
      seq: this.seq,
    }
  }

  static fromSnapshot(
    registry: NodeRegistry,
    snapshot: CommandLogSnapshot,
    now?: () => number,
  ): CommandLog {
    return new CommandLog({
      doc: snapshot.doc,
      registry,
      entries: snapshot.entries,
      seq: snapshot.seq,
      now,
    })
  }
}

export interface CommandLogSnapshot {
  doc: CanvasDoc
  entries: HistoryEntry[]
  seq: number
}

