import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer'
import { CanvasError } from './errors'
import type { HistoryEntry, HistoryState } from './history'
import type {
  BatchCommand,
  Command,
  DocumentCommand,
  HistoryRedoCommand,
  HistoryUndoCommand,
} from './commands'
import { isDocumentCommand } from './commands'
import type { NodeRegistry } from './registry/registry'
import type { NodeDefinition, PortDef } from './registry/types'
import type { CanvasDoc, CanvasNode, MediaType, Source, Vec2 } from './types'

enablePatches()

let idCounter = 0

function newId(prefix: string): string {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (maybeCrypto?.randomUUID) {
    return `${prefix}_${maybeCrypto.randomUUID().slice(0, 8)}`
  }
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function nodeLabel(node: CanvasNode): string {
  return node.data.label?.trim() || node.type
}

function normalizePosition(position: Vec2 | undefined): Vec2 {
  const x = Number(position?.x ?? 0)
  const y = Number(position?.y ?? 0)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new CanvasError('INVALID_COMMAND', '坐标必须是有限数字')
  }
  return { x, y }
}

function parseParams(
  def: NodeDefinition,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result = def.params.safeParse(value)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new CanvasError('INVALID_PARAMS', `${def.title} 参数不合法：${detail}`, result.error.issues)
  }
  return result.data as Record<string, unknown>
}

function isPortCompatible(a: MediaType, b: MediaType): boolean {
  return a === b || a === 'any' || b === 'any'
}

function canReach(doc: CanvasDoc, from: string, to: string): boolean {
  if (from === to) return true
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const current = stack.pop() as string
    if (current === to) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of Object.values(doc.edges)) {
      if (edge.source === current) stack.push(edge.target)
    }
  }
  return false
}

interface OpOutcome {
  label: string
  nodes: string[]
  edges: string[]
  createdNodes: string[]
  createdEdges: string[]
}

function emptyOutcome(label: string): OpOutcome {
  return { label, nodes: [], edges: [], createdNodes: [], createdEdges: [] }
}

function mergeOutcome(target: OpOutcome, source: OpOutcome): OpOutcome {
  target.nodes = unique([...target.nodes, ...source.nodes])
  target.edges = unique([...target.edges, ...source.edges])
  target.createdNodes = unique([...target.createdNodes, ...source.createdNodes])
  target.createdEdges = unique([...target.createdEdges, ...source.createdEdges])
  return target
}

function findPort(ports: PortDef[], id: string): PortDef | undefined {
  return ports.find((port) => port.id === id)
}

function defaultPosition(doc: CanvasDoc): Vec2 {
  const count = doc.nodeOrder.length
  return { x: 160 + (count % 4) * 70, y: 140 + (count % 3) * 90 }
}

function applyOp(
  draft: Draft<CanvasDoc>,
  op: DocumentCommand,
  registry: NodeRegistry,
  isRoot = true,
): OpOutcome {
  switch (op.type) {
    case 'node.add': {
      const spec = op.payload?.node
      if (!spec || typeof spec.type !== 'string' || spec.type.length === 0) {
        throw new CanvasError('INVALID_COMMAND', 'node.add 缺少节点类型')
      }
      const def = registry.get(spec.type)
      const id = spec.id ?? newId('n')
      if (draft.nodes[id]) {
        throw new CanvasError('DUPLICATE_ID', `节点 id 已存在：${id}`)
      }
      const position = normalizePosition(spec.position ?? defaultPosition(draft))
      const params = parseParams(def, { ...def.defaults, ...(spec.params ?? {}) })
      draft.nodes[id] = {
        id,
        type: def.type,
        position,
        data: { label: spec.label ?? def.title, params },
      }
      draft.nodeOrder.push(id)
      return {
        label: `添加「${def.title}」`,
        nodes: [id],
        edges: [],
        createdNodes: [id],
        createdEdges: [],
      }
    }

    case 'node.move': {
      const moves = op.payload?.moves
      if (!Array.isArray(moves) || moves.length === 0) {
        throw new CanvasError('INVALID_COMMAND', 'node.move 需要至少一个节点')
      }
      const normalized = moves.map((move) => {
        if (!move || typeof move.id !== 'string') {
          throw new CanvasError('INVALID_COMMAND', 'node.move 缺少节点 id')
        }
        const node = draft.nodes[move.id]
        if (!node) throw new CanvasError('NODE_NOT_FOUND', `节点不存在：${move.id}`)
        return { node, position: normalizePosition(move.position) }
      })
      for (const { node, position } of normalized) {
        if (node.position.x !== position.x || node.position.y !== position.y) {
          node.position = position
        }
      }
      const labels = normalized.map(({ node }) => nodeLabel(node))
      const label =
        normalized.length === 1 ? `移动「${labels[0]}」` : `移动 ${normalized.length} 个节点`
      return {
        label,
        nodes: normalized.map(({ node }) => node.id),
        edges: [],
        createdNodes: [],
        createdEdges: [],
      }
    }

    case 'node.update': {
      const id = op.payload?.id
      if (typeof id !== 'string') {
        throw new CanvasError('INVALID_COMMAND', 'node.update 缺少节点 id')
      }
      const node = draft.nodes[id]
      if (!node) throw new CanvasError('NODE_NOT_FOUND', `节点不存在：${id}`)
      const def = registry.get(node.type)
      const oldLabel = nodeLabel(node)
      const paramPatch = op.payload.params
      let changedKeys: string[] = []
      if (paramPatch !== undefined) {
        if (typeof paramPatch !== 'object' || paramPatch === null || Array.isArray(paramPatch)) {
          throw new CanvasError('INVALID_COMMAND', 'params 必须是对象')
        }
        changedKeys = Object.keys(paramPatch)
        const nextParams = parseParams(def, { ...node.data.params, ...paramPatch })
        if (JSON.stringify(nextParams) !== JSON.stringify(node.data.params)) {
          node.data.params = nextParams
        }
      }
      if (op.payload.label !== undefined) {
        if (typeof op.payload.label !== 'string') {
          throw new CanvasError('INVALID_COMMAND', 'label 必须是字符串')
        }
        if (op.payload.label !== node.data.label) {
          node.data.label = op.payload.label
        }
      }
      let label: string
      if (changedKeys.length > 0) {
        label = `修改「${oldLabel}」的 ${changedKeys.join('、')}`
      } else if (op.payload.label !== undefined) {
        label = `重命名「${oldLabel}」→「${nodeLabel(node)}」`
      } else {
        label = `修改「${oldLabel}」`
      }
      return {
        label,
        nodes: [id],
        edges: [],
        createdNodes: [],
        createdEdges: [],
      }
    }

    case 'node.delete': {
      const ids = op.payload?.ids
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new CanvasError('INVALID_COMMAND', 'node.delete 需要至少一个节点')
      }
      const uniqueIds = unique(ids)
      const labels: string[] = []
      for (const id of uniqueIds) {
        const node = draft.nodes[id]
        if (!node) throw new CanvasError('NODE_NOT_FOUND', `节点不存在：${id}`)
        labels.push(nodeLabel(node))
      }
      const idSet = new Set(uniqueIds)
      const cascadedEdges = Object.values(draft.edges)
        .filter((edge) => idSet.has(edge.source) || idSet.has(edge.target))
        .map((edge) => edge.id)
      const cascadeSet = new Set(cascadedEdges)
      for (const edgeId of cascadedEdges) delete draft.edges[edgeId]
      draft.edgeOrder = draft.edgeOrder.filter((edgeId) => !cascadeSet.has(edgeId))
      for (const id of uniqueIds) delete draft.nodes[id]
      draft.nodeOrder = draft.nodeOrder.filter((nodeId) => !idSet.has(nodeId))
      const label =
        uniqueIds.length === 1 ? `删除「${labels[0]}」` : `删除 ${uniqueIds.length} 个节点`
      return {
        label,
        nodes: uniqueIds,
        edges: cascadedEdges,
        createdNodes: [],
        createdEdges: [],
      }
    }

    case 'edge.connect': {
      const payload = op.payload
      if (!payload || typeof payload.source !== 'string' || typeof payload.target !== 'string') {
        throw new CanvasError('INVALID_COMMAND', 'edge.connect 缺少源/目标节点')
      }
      const source = draft.nodes[payload.source]
      if (!source) throw new CanvasError('NODE_NOT_FOUND', `源节点不存在：${payload.source}`)
      const target = draft.nodes[payload.target]
      if (!target) throw new CanvasError('NODE_NOT_FOUND', `目标节点不存在：${payload.target}`)
      if (source.id === target.id) {
        throw new CanvasError('SELF_LOOP', '不允许节点连接自己')
      }
      const sourceDef = registry.get(source.type)
      const targetDef = registry.get(target.type)
      const sourcePortId = payload.sourcePort ?? sourceDef.outputs[0]?.id
      const targetPortId = payload.targetPort ?? targetDef.inputs[0]?.id
      const sourcePort = sourcePortId ? findPort(sourceDef.outputs, sourcePortId) : undefined
      if (!sourcePort) {
        throw new CanvasError(
          'PORT_NOT_FOUND',
          `输出端口不存在：${String(sourcePortId)}（${sourceDef.title}）`,
        )
      }
      const targetPort = targetPortId ? findPort(targetDef.inputs, targetPortId) : undefined
      if (!targetPort) {
        throw new CanvasError(
          'PORT_NOT_FOUND',
          `输入端口不存在：${String(targetPortId)}（${targetDef.title}）`,
        )
      }
      if (!isPortCompatible(sourcePort.type, targetPort.type)) {
        throw new CanvasError(
          'TYPE_MISMATCH',
          `类型不匹配：${sourcePort.type} → ${targetPort.type}`,
        )
      }
      const duplicate = Object.values(draft.edges).some(
        (edge) =>
          edge.source === source.id &&
          edge.sourcePort === sourcePort.id &&
          edge.target === target.id &&
          edge.targetPort === targetPort.id,
      )
      if (duplicate) {
        throw new CanvasError('DUPLICATE_EDGE', '这条连线已经存在')
      }
      if (!targetPort.multi) {
        const occupied = Object.values(draft.edges).some(
          (edge) => edge.target === target.id && edge.targetPort === targetPort.id,
        )
        if (occupied) {
          throw new CanvasError(
            'PORT_OCCUPIED',
            `「${targetPort.label}」只能接一条连线`,
          )
        }
      }
      if (canReach(draft, target.id, source.id)) {
        throw new CanvasError('CYCLE', '这条连线会形成环')
      }
      const id = payload.id ?? newId('e')
      if (draft.edges[id]) {
        throw new CanvasError('DUPLICATE_ID', `连线 id 已存在：${id}`)
      }
      draft.edges[id] = {
        id,
        source: source.id,
        sourcePort: sourcePort.id,
        target: target.id,
        targetPort: targetPort.id,
      }
      draft.edgeOrder.push(id)
      return {
        label: `连接「${nodeLabel(source)}」→「${nodeLabel(target)}」`,
        nodes: [source.id, target.id],
        edges: [id],
        createdNodes: [],
        createdEdges: [id],
      }
    }

    case 'edge.disconnect': {
      const ids = op.payload?.ids
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new CanvasError('INVALID_COMMAND', 'edge.disconnect 需要至少一条连线')
      }
      const uniqueIds = unique(ids)
      const nodes: string[] = []
      for (const id of uniqueIds) {
        const edge = draft.edges[id]
        if (!edge) throw new CanvasError('EDGE_NOT_FOUND', `连线不存在：${id}`)
        nodes.push(edge.source, edge.target)
      }
      const idSet = new Set(uniqueIds)
      for (const id of uniqueIds) delete draft.edges[id]
      draft.edgeOrder = draft.edgeOrder.filter((edgeId) => !idSet.has(edgeId))
      return {
        label: uniqueIds.length === 1 ? '删除 1 条连线' : `删除 ${uniqueIds.length} 条连线`,
        nodes: unique(nodes),
        edges: uniqueIds,
        createdNodes: [],
        createdEdges: [],
      }
    }

    case 'batch': {
      if (!isRoot) {
        throw new CanvasError('INVALID_BATCH', 'batch 不允许嵌套')
      }
      const batch = op as BatchCommand
      const ops = batch.payload?.ops
      if (!Array.isArray(ops) || ops.length === 0) {
        throw new CanvasError('INVALID_BATCH', 'batch 需要至少一步操作')
      }
      if (ops.length > 100) {
        throw new CanvasError('INVALID_BATCH', 'batch 最多 100 步')
      }
      const combined = emptyOutcome(batch.label ?? `批量操作（${ops.length} 步）`)
      for (const child of ops) {
        if (!child || typeof child !== 'object' || typeof child.type !== 'string') {
          throw new CanvasError('INVALID_BATCH', 'batch 中存在非法操作')
        }
        if (child.type === 'batch') {
          throw new CanvasError('INVALID_BATCH', 'batch 不允许嵌套')
        }
        if (!isDocumentCommand(child as Command)) {
          throw new CanvasError('INVALID_BATCH', `batch 只接受文档操作：${child.type}`)
        }
        const outcome = applyOp(draft, child as DocumentCommand, registry, false)
        mergeOutcome(combined, outcome)
      }
      combined.label = batch.label ?? `批量操作（${ops.length} 步）`
      return combined
    }

    default: {
      const exhaustive: never = op
      throw new CanvasError(
        'INVALID_COMMAND',
        `不支持的文档命令：${(exhaustive as { type?: string }).type ?? 'unknown'}`,
      )
    }
  }
}

export interface EngineSnapshot {
  doc: CanvasDoc
  entries: HistoryEntry[]
  cursor: number
  seq: number
}

export interface CanvasEngineOptions {
  doc: CanvasDoc
  registry: NodeRegistry
  historyLimit?: number
  now?: () => number
}

export interface ExecuteResult {
  commandId: string
  rev: number
  patch: Patch[]
  cursor: number
  changed: boolean
  entry?: HistoryEntry
  history?: HistoryState
  undone?: string
  redone?: string
  affected: { nodes: string[]; edges: string[] }
  created: { nodes: string[]; edges: string[] }
}

export interface ExecuteMeta {
  source?: Source
  actorId?: string
}

export class CanvasEngine {
  private doc: CanvasDoc
  private entries: HistoryEntry[]
  private cursor: number
  private seq: number
  private readonly registry: NodeRegistry
  private readonly historyLimit: number
  private readonly now: () => number

  constructor(options: CanvasEngineOptions & Partial<EngineSnapshot>) {
    this.doc = options.doc
    this.registry = options.registry
    this.entries = options.entries ?? []
    this.cursor = Math.max(0, Math.min(options.cursor ?? this.entries.length, this.entries.length))
    this.seq = options.seq ?? this.entries.reduce((max, entry) => Math.max(max, entry.seq), 0)
    this.historyLimit = Math.max(1, options.historyLimit ?? 100)
    this.now = options.now ?? (() => Date.now())
  }

  static fromSnapshot(
    registry: NodeRegistry,
    snapshot: EngineSnapshot,
    options?: Omit<CanvasEngineOptions, 'doc' | 'registry'>,
  ): CanvasEngine {
    return new CanvasEngine({ ...options, registry, ...snapshot })
  }

  getDoc(): CanvasDoc {
    return this.doc
  }

  getHistory(): HistoryState {
    return { entries: this.entries, cursor: this.cursor }
  }

  getCursor(): number {
    return this.cursor
  }

  toSnapshot(): EngineSnapshot {
    return {
      doc: this.doc,
      entries: this.entries,
      cursor: this.cursor,
      seq: this.seq,
    }
  }

  execute(input: Command, meta: ExecuteMeta = {}): ExecuteResult {
    const id = input.id ?? newId('c')
    const ts = input.ts ?? this.now()
    const source = input.source ?? meta.source ?? 'user'
    const actorId = input.actorId ?? meta.actorId

    if (input.type === 'history.undo') {
      return this.undo(input, id, ts, source, actorId)
    }
    if (input.type === 'history.redo') {
      return this.redo(input, id, ts, source, actorId)
    }

    if (!isDocumentCommand(input)) {
      throw new CanvasError(
        'INVALID_COMMAND',
        `${input.type} 不是文档命令，应由执行引擎处理`,
      )
    }

    let outcome: OpOutcome | undefined
    const [nextDoc, patches, inversePatches] = produceWithPatches(this.doc, (draft) => {
      outcome = applyOp(draft, input, this.registry)
    })

    if (!outcome) {
      throw new CanvasError('INVALID_COMMAND', '命令没有产生结果')
    }

    if (patches.length === 0) {
      return {
        commandId: id,
        rev: this.doc.rev,
        patch: [],
        cursor: this.cursor,
        changed: false,
        affected: { nodes: [], edges: [] },
        created: { nodes: [], edges: [] },
      }
    }

    this.seq += 1
    const entry: HistoryEntry = {
      id,
      seq: this.seq,
      docId: this.doc.id,
      type: input.type,
      source,
      actorId,
      label: input.label ?? outcome.label,
      forward: patches,
      inverse: inversePatches,
      nodes: unique(outcome.nodes),
      edges: unique(outcome.edges),
      ts,
    }

    this.entries = this.entries.slice(0, this.cursor)
    this.entries.push(entry)
    this.cursor = this.entries.length
    while (this.entries.length > this.historyLimit) {
      this.entries.shift()
      this.cursor -= 1
    }
    this.cursor = Math.max(0, this.cursor)

    this.doc = { ...nextDoc, rev: this.doc.rev + 1 }

    return {
      commandId: id,
      rev: this.doc.rev,
      patch: patches,
      cursor: this.cursor,
      changed: true,
      entry,
      affected: { nodes: unique(outcome.nodes), edges: unique(outcome.edges) },
      created: {
        nodes: unique(outcome.createdNodes),
        edges: unique(outcome.createdEdges),
      },
    }
  }

  private undo(
    command: HistoryUndoCommand,
    id: string,
    ts: number,
    source: Source,
    actorId?: string,
  ): ExecuteResult {
    const entry = this.entries[this.cursor - 1]
    if (!entry) {
      throw new CanvasError('NOTHING_TO_UNDO', '没有可撤销的操作')
    }
    const requested = command.payload?.entryId
    if (requested && requested !== entry.id) {
      throw new CanvasError(
        'OUT_OF_ORDER_UNDO',
        '当前只支持按顺序撤销（LIFO）；请先撤销更新的操作',
        { requested, top: entry.id },
      )
    }

    const nextDoc = applyPatches(this.doc, entry.inverse)
    this.doc = { ...nextDoc, rev: this.doc.rev + 1 }
    this.cursor -= 1

    void ts
    void source
    void actorId

    return {
      commandId: id,
      rev: this.doc.rev,
      patch: entry.inverse,
      cursor: this.cursor,
      changed: true,
      history: { entries: this.entries, cursor: this.cursor },
      undone: entry.id,
      affected: { nodes: entry.nodes, edges: entry.edges },
      created: { nodes: [], edges: [] },
    }
  }

  private redo(
    command: HistoryRedoCommand,
    id: string,
    ts: number,
    source: Source,
    actorId?: string,
  ): ExecuteResult {
    const entry = this.entries[this.cursor]
    if (!entry) {
      throw new CanvasError('NOTHING_TO_REDO', '没有可重做的操作')
    }

    const nextDoc = applyPatches(this.doc, entry.forward)
    this.doc = { ...nextDoc, rev: this.doc.rev + 1 }
    this.cursor += 1

    void command
    void ts
    void source
    void actorId

    return {
      commandId: id,
      rev: this.doc.rev,
      patch: entry.forward,
      cursor: this.cursor,
      changed: true,
      history: { entries: this.entries, cursor: this.cursor },
      redone: entry.id,
      affected: { nodes: entry.nodes, edges: entry.edges },
      created: { nodes: [], edges: [] },
    }
  }
}

export function createEmptyDoc(id: string): CanvasDoc {
  return {
    id,
    rev: 0,
    nodes: {},
    edges: {},
    nodeOrder: [],
    edgeOrder: [],
  }
}
