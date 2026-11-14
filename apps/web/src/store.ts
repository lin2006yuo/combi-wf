import { create } from 'zustand'
import { applyPatches } from 'immer'
import type {
  AppliedMessage,
  CanvasDoc,
  HistoryEntry,
  NodeRuntime,
  SnapshotMessage,
  Source,
  Vec2,
} from '@combi/canvas-core'
import type { ServerInfo } from './api'

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

interface AppState {
  doc: CanvasDoc | null
  history: HistoryEntry[]
  cursor: number
  runtime: Record<string, NodeRuntime>
  status: ConnectionStatus
  selectedIds: string[]
  dragPositions: Record<string, Vec2>
  tab: PanelTab
  activity: ActivityItem[]
  toasts: ToastItem[]
  info: ServerInfo | null

  setSnapshot: (snapshot: SnapshotMessage) => void
  applyMessage: (message: AppliedMessage) => void
  setRuntime: (nodeId: string, runtime: NodeRuntime | null) => void
  setStatus: (status: ConnectionStatus) => void
  select: (id: string | null, additive?: boolean) => void
  setDrag: (id: string, position: Vec2) => void
  clearDrag: (ids: string[]) => void
  setTab: (tab: PanelTab) => void
  setInfo: (info: ServerInfo) => void
  toast: (message: string, level?: ToastItem['level']) => void
  dismissToast: (id: string) => void
}

function nodeLabel(doc: CanvasDoc | null, id: string): string {
  const node = doc?.nodes[id]
  return node?.data.label?.trim() || node?.type || id
}

const RUNTIME_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '开始生成',
  succeeded: '生成完成',
  failed: '生成失败',
  canceled: '已取消',
}

export const useAppStore = create<AppState>()((set, get) => ({
  doc: null,
  history: [],
  cursor: 0,
  runtime: {},
  status: 'connecting',
  selectedIds: [],
  dragPositions: {},
  tab: 'inspector',
  activity: [],
  toasts: [],
  info: null,

  setSnapshot: (snapshot) =>
    set((state) => ({
      doc: snapshot.doc,
      history: snapshot.history,
      cursor: snapshot.cursor,
      runtime: snapshot.runtime,
      selectedIds: state.selectedIds.filter((id) => Boolean(snapshot.doc.nodes[id])),
      dragPositions: {},
    })),

  applyMessage: (message) =>
    set((state) => {
      if (!state.doc) return state
      const patched =
        message.patch.length > 0 ? applyPatches(state.doc, message.patch) : state.doc
      const doc = { ...patched, rev: message.rev }
      let history = state.history
      const cursor = message.cursor
      const activity = [...state.activity]

      if (message.history) {
        history = message.history
      } else if (message.entry) {
        const base = state.history.slice(0, Math.max(0, message.cursor - 1))
        history = [...base, message.entry]
        activity.unshift({
          id: message.entry.id,
          ts: message.entry.ts,
          source: message.entry.source,
          actorId: message.entry.actorId,
          label: message.entry.label,
          kind: 'command',
        })
      }

      if (message.undone) {
        const entry = state.history.find((item) => item.id === message.undone)
        activity.unshift({
          id: `undo-${message.commandId}`,
          ts: Date.now(),
          source: 'undo',
          label: entry ? `撤销「${entry.label}」` : '撤销一步操作',
          kind: 'undo',
        })
      }
      if (message.redone) {
        const entry = state.history.find((item) => item.id === message.redone)
        activity.unshift({
          id: `redo-${message.commandId}`,
          ts: Date.now(),
          source: 'undo',
          label: entry ? `重做「${entry.label}」` : '重做一步操作',
          kind: 'redo',
        })
      }

      return { doc, history, cursor, activity: activity.slice(0, 80) }
    }),

  setRuntime: (nodeId, runtime) =>
    set((state) => {
      const previous = state.runtime[nodeId]
      const nextRuntime = { ...state.runtime }
      if (runtime) nextRuntime[nodeId] = runtime
      else delete nextRuntime[nodeId]

      let activity = state.activity
      if (runtime && previous?.status !== runtime.status) {
        const text = RUNTIME_LABEL[runtime.status]
        if (text) {
          activity = [
            {
              id: `runtime-${nodeId}-${runtime.updatedAt}`,
              ts: Date.now(),
              source: 'system',
              label: `「${nodeLabel(state.doc, nodeId)}」${text}`,
              kind: 'runtime' as const,
            },
            ...state.activity,
          ]
        }
      }
      return { runtime: nextRuntime, activity: activity.slice(0, 80) }
    }),

  setStatus: (status) => set({ status }),

  select: (id, additive = false) =>
    set((state) => {
      if (!id) return { selectedIds: [] }
      if (additive) {
        const exists = state.selectedIds.includes(id)
        return {
          selectedIds: exists
            ? state.selectedIds.filter((value) => value !== id)
            : [...state.selectedIds, id],
          tab: 'inspector' as PanelTab,
        }
      }
      return { selectedIds: [id], tab: 'inspector' as PanelTab }
    }),

  setDrag: (id, position) =>
    set((state) => ({ dragPositions: { ...state.dragPositions, [id]: position } })),

  clearDrag: (ids) =>
    set((state) => {
      if (ids.length === 0) return state
      const next = { ...state.dragPositions }
      for (const id of ids) delete next[id]
      return { dragPositions: next }
    }),

  setTab: (tab) => set({ tab }),

  setInfo: (info) => set({ info }),

  toast: (message, level = 'info') => {
    const id = Math.random().toString(36).slice(2)
    set((state) => ({ toasts: [...state.toasts, { id, message, level }] }))
    setTimeout(() => get().dismissToast(id), 4200)
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
