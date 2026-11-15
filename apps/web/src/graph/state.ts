import { computed, signal, type Signal } from '@preact/signals-core'
import { applyPatches } from 'immer'
import type {
  AppliedMessage,
  CanvasDoc,
  CanvasNode,
  HistoryEntry,
  NodeRuntime,
  SnapshotMessage,
  Source,
  Vec2,
} from '@combi/canvas-core'
import type { ServerInfo } from '../api'

export type ConnectionStatus = 'connecting' | 'open' | 'closed'
export type PanelTab = 'inspector' | 'history' | 'activity'

export interface ActivityItem {
  id: string
  ts: number
  source: Source | 'system'
  actorId?: string
  label: string
  kind: 'command' | 'undo' | 'redo' | 'runtime'
}

export interface ToastItem {
  id: string
  message: string
  level: 'info' | 'warn' | 'error'
}

export interface NodeView {
  type: string
  position: Vec2
}

export interface EdgeView {
  source: string
  sourcePort: string
  target: string
  targetPort: string
}

const EMPTY_RUNTIME = signal<NodeRuntime | undefined>(undefined)

const RUNTIME_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '开始生成',
  succeeded: '生成完成',
  failed: '生成失败',
  canceled: '已取消',
}

/**
 * 客户端的 Graph Runtime。
 *
 * - nodeSignals / runtimeSignals 是 per-record signal，组件按 id 订阅。
 * - views / edgeViews 只承载 React Flow 需要的几何和拓扑，params/runtime 不进去。
 * - history 是服务端 change log 的镜像；cursor 由 applied 数量推导，属于前端。
 */
export class GraphState {
  private doc: CanvasDoc | null = null
  private readonly nodeSignals = new Map<string, Signal<CanvasNode>>()
  private readonly runtimeSignals = new Map<string, Signal<NodeRuntime | undefined>>()

  readonly loaded = signal(false)
  readonly rev = signal(0)
  readonly nodeOrder = signal<string[]>([])
  readonly edgeOrder = signal<string[]>([])
  readonly views = signal<Record<string, NodeView>>({})
  readonly edgeViews = signal<Record<string, EdgeView>>({})
  readonly history = signal<HistoryEntry[]>([])
  readonly selectedIds = signal<string[]>([])
  readonly dragPositions = signal<Record<string, Vec2>>({})
  readonly runtimeMap = signal<Record<string, NodeRuntime>>({})
  readonly status = signal<ConnectionStatus>('connecting')
  readonly activity = signal<ActivityItem[]>([])
  readonly toasts = signal<ToastItem[]>([])
  readonly info = signal<ServerInfo | null>(null)
  readonly tab = signal<PanelTab>('inspector')

  readonly appliedCount = computed(
    () => this.history.value.filter((entry) => entry.status === 'applied').length,
  )
  readonly canUndo = computed(() =>
    this.history.value.some((entry) => entry.status === 'applied'),
  )
  readonly canRedo = computed(() =>
    this.history.value.some((entry) => entry.status === 'undone'),
  )
  readonly anyRunning = computed(() =>
    Object.values(this.runtimeMap.value).some(
      (runtime) => runtime.status === 'queued' || runtime.status === 'running',
    ),
  )

  applySnapshot(snapshot: SnapshotMessage): void {
    this.doc = snapshot.doc
    this.nodeSignals.clear()
    this.runtimeSignals.clear()

    const views: Record<string, NodeView> = {}
    for (const id of snapshot.doc.nodeOrder) {
      const node = snapshot.doc.nodes[id]
      this.nodeSignals.set(id, signal(node))
      this.runtimeSignals.set(id, signal(snapshot.runtime[id] ?? undefined))
      views[id] = { type: node.type, position: node.position }
    }

    this.nodeOrder.value = [...snapshot.doc.nodeOrder]
    this.edgeOrder.value = [...snapshot.doc.edgeOrder]
    this.views.value = views
    this.edgeViews.value = buildEdgeViews(snapshot.doc)
    this.history.value = snapshot.history
    this.runtimeMap.value = { ...snapshot.runtime }
    this.rev.value = snapshot.doc.rev
    this.selectedIds.value = this.selectedIds.value.filter((id) => Boolean(snapshot.doc.nodes[id]))
    this.dragPositions.value = {}
    this.loaded.value = true
  }

  applyApplied(message: AppliedMessage): void {
    if (!this.doc) return
    const previous = this.doc
    const patched =
      message.patch.length > 0 ? applyPatches(previous, message.patch) : previous
    const next: CanvasDoc = { ...patched, rev: message.rev }
    this.doc = next
    this.rev.value = message.rev

    let views = this.views.value
    let viewsChanged = false
    let edgeViews = this.edgeViews.value
    let edgeViewsChanged = false

    for (const id of message.affected.nodes) {
      const node = next.nodes[id]
      if (!node) {
        this.nodeSignals.delete(id)
        this.runtimeSignals.delete(id)
        if (id in views) {
          views = { ...views }
          delete views[id]
          viewsChanged = true
        }
        continue
      }

      const nodeSignal = this.nodeSignals.get(id)
      if (nodeSignal) nodeSignal.value = node
      else this.nodeSignals.set(id, signal(node))
      if (!this.runtimeSignals.has(id)) this.runtimeSignals.set(id, signal(undefined))

      const previousView = views[id]
      if (
        !previousView ||
        previousView.type !== node.type ||
        previousView.position.x !== node.position.x ||
        previousView.position.y !== node.position.y
      ) {
        if (!viewsChanged) views = { ...views }
        views[id] = { type: node.type, position: node.position }
        viewsChanged = true
      }
    }

    for (const id of message.affected.edges) {
      const edge = next.edges[id]
      if (!edge) {
        if (id in edgeViews) {
          if (!edgeViewsChanged) edgeViews = { ...edgeViews }
          delete edgeViews[id]
          edgeViewsChanged = true
        }
        continue
      }
      const previousEdge = edgeViews[id]
      if (
        !previousEdge ||
        previousEdge.source !== edge.source ||
        previousEdge.sourcePort !== edge.sourcePort ||
        previousEdge.target !== edge.target ||
        previousEdge.targetPort !== edge.targetPort
      ) {
        if (!edgeViewsChanged) edgeViews = { ...edgeViews }
        edgeViews[id] = {
          source: edge.source,
          sourcePort: edge.sourcePort,
          target: edge.target,
          targetPort: edge.targetPort,
        }
        edgeViewsChanged = true
      }
    }

    if (next.nodeOrder !== previous.nodeOrder) {
      this.nodeOrder.value = [...next.nodeOrder]
    }
    if (next.edgeOrder !== previous.edgeOrder) {
      this.edgeOrder.value = [...next.edgeOrder]
    }
    if (viewsChanged) this.views.value = views
    if (edgeViewsChanged) this.edgeViews.value = edgeViews

    const selected = this.selectedIds.value.filter((id) => Boolean(next.nodes[id]))
    if (selected.length !== this.selectedIds.value.length) this.selectedIds.value = selected

    if (message.history) {
      this.history.value = message.history
    } else if (message.entry) {
      const kept = this.history.value.filter(
        (entry) => entry.status === 'applied' && !message.discarded?.includes(entry.id),
      )
      this.history.value = [...kept, message.entry]
      this.addActivity({
        id: message.entry.id,
        ts: message.entry.ts,
        source: message.entry.source,
        actorId: message.entry.actorId,
        label: message.entry.label,
        kind: 'command',
      })
    } else if (message.undone) {
      this.history.value = this.history.value.map((entry) =>
        entry.id === message.undone ? { ...entry, status: 'undone' } : entry,
      )
    } else if (message.redone) {
      this.history.value = this.history.value.map((entry) =>
        entry.id === message.redone ? { ...entry, status: 'applied' } : entry,
      )
    }

    if (message.undone) {
      const entry = this.history.value.find((item) => item.id === message.undone)
      this.addActivity({
        id: `undo-${message.commandId}`,
        ts: Date.now(),
        source: 'undo',
        label: entry ? `撤销「${entry.label}」` : '撤销一步操作',
        kind: 'undo',
      })
    }
    if (message.redone) {
      const entry = this.history.value.find((item) => item.id === message.redone)
      this.addActivity({
        id: `redo-${message.commandId}`,
        ts: Date.now(),
        source: 'undo',
        label: entry ? `重做「${entry.label}」` : '重做一步操作',
        kind: 'redo',
      })
    }
  }

  setRuntime(nodeId: string, runtime: NodeRuntime | null): void {
    const previous = this.runtimeMap.value[nodeId]
    const nextMap = { ...this.runtimeMap.value }
    if (runtime) nextMap[nodeId] = runtime
    else delete nextMap[nodeId]
    this.runtimeMap.value = nextMap

    let runtimeSignal = this.runtimeSignals.get(nodeId)
    if (!runtimeSignal) {
      runtimeSignal = signal(undefined)
      this.runtimeSignals.set(nodeId, runtimeSignal)
    }
    runtimeSignal.value = runtime ?? undefined

    if (runtime && previous?.status !== runtime.status) {
      const text = RUNTIME_LABEL[runtime.status]
      if (text) {
        this.addActivity({
          id: `runtime-${nodeId}-${runtime.updatedAt}`,
          ts: Date.now(),
          source: 'system',
          label: `「${this.nodeLabel(nodeId)}」${text}`,
          kind: 'runtime',
        })
      }
    }
  }

  setStatus(status: ConnectionStatus): void {
    this.status.value = status
  }

  select(id: string | null, additive = false): void {
    if (!id) {
      this.selectedIds.value = []
      return
    }
    if (additive) {
      const exists = this.selectedIds.value.includes(id)
      this.selectedIds.value = exists
        ? this.selectedIds.value.filter((value) => value !== id)
        : [...this.selectedIds.value, id]
    } else {
      this.selectedIds.value = [id]
    }
    this.tab.value = 'inspector'
  }

  setDrag(id: string, position: Vec2): void {
    this.dragPositions.value = { ...this.dragPositions.value, [id]: position }
  }

  clearDrag(ids: string[]): void {
    if (ids.length === 0) return
    const next = { ...this.dragPositions.value }
    for (const id of ids) delete next[id]
    this.dragPositions.value = next
  }

  setTab(tab: PanelTab): void {
    this.tab.value = tab
  }

  setInfo(info: ServerInfo): void {
    this.info.value = info
  }

  getDoc(): CanvasDoc | null {
    return this.doc
  }

  getNode(id: string): CanvasNode | undefined {
    return this.doc?.nodes[id]
  }

  nodeSignal(id: string): Signal<CanvasNode> | undefined {
    return this.nodeSignals.get(id)
  }

  runtimeSignal(id: string): Signal<NodeRuntime | undefined> {
    const existing = this.runtimeSignals.get(id)
    if (existing) return existing
    if (!this.doc?.nodes[id]) return EMPTY_RUNTIME
    const created = signal<NodeRuntime | undefined>(undefined)
    this.runtimeSignals.set(id, created)
    return created
  }

  getTopApplied(): HistoryEntry | undefined {
    return [...this.history.value].reverse().find((entry) => entry.status === 'applied')
  }

  getFirstUndone(): HistoryEntry | undefined {
    return this.history.value.find((entry) => entry.status === 'undone')
  }

  toast(message: string, level: ToastItem['level'] = 'info'): void {
    const id = Math.random().toString(36).slice(2)
    this.toasts.value = [...this.toasts.value, { id, message, level }]
    setTimeout(() => this.dismissToast(id), 4200)
  }

  dismissToast(id: string): void {
    this.toasts.value = this.toasts.value.filter((toast) => toast.id !== id)
  }

  private addActivity(item: ActivityItem): void {
    this.activity.value = [item, ...this.activity.value].slice(0, 80)
  }

  private nodeLabel(id: string): string {
    const node = this.doc?.nodes[id]
    return node?.data.label?.trim() || node?.type || id
  }
}

function buildEdgeViews(doc: CanvasDoc): Record<string, EdgeView> {
  const result: Record<string, EdgeView> = {}
  for (const id of doc.edgeOrder) {
    const edge = doc.edges[id]
    result[id] = {
      source: edge.source,
      sourcePort: edge.sourcePort,
      target: edge.target,
      targetPort: edge.targetPort,
    }
  }
  return result
}

export const graph = new GraphState()
