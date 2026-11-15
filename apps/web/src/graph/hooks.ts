import { useSignals } from '@preact/signals-react/runtime'
import { graph } from './state'

/**
 * 每个组件只调用一次 useSignals，然后读取这里返回的普通值。
 * 这样依赖是“这个组件读了哪些 signal”，而不是整个 store。
 */
export function useAppModel() {
  useSignals()
  return {
    loaded: graph.loaded.value,
    status: graph.status.value,
    info: graph.info.value,
  }
}

export function useCanvasModel() {
  useSignals()
  return {
    nodeOrder: graph.nodeOrder.value,
    edgeOrder: graph.edgeOrder.value,
    views: graph.views.value,
    edgeViews: graph.edgeViews.value,
    dragPositions: graph.dragPositions.value,
    selectedIds: graph.selectedIds.value,
  }
}

export function useFlowNodeModel(id: string) {
  useSignals()
  return {
    node: graph.nodeSignal(id)?.value,
    runtime: graph.runtimeSignal(id).value,
  }
}

export function useInspectorModel() {
  useSignals()
  const selectedIds = graph.selectedIds.value
  const id = selectedIds[0]
  return {
    selectedIds,
    node: id ? graph.nodeSignal(id)?.value : undefined,
    runtime: id ? graph.runtimeSignal(id).value : undefined,
  }
}

export function useToolbarModel() {
  useSignals()
  return {
    rev: graph.rev.value,
    nodeCount: graph.nodeOrder.value.length,
    history: graph.history.value,
    status: graph.status.value,
    anyRunning: graph.anyRunning.value,
    canUndo: graph.canUndo.value,
    canRedo: graph.canRedo.value,
  }
}

export function useHistoryModel() {
  useSignals()
  return {
    history: graph.history.value,
    appliedCount: graph.appliedCount.value,
    canUndo: graph.canUndo.value,
    canRedo: graph.canRedo.value,
  }
}

export function useActivityModel() {
  useSignals()
  return { activity: graph.activity.value }
}

export function useToastsModel() {
  useSignals()
  return { toasts: graph.toasts.value }
}

export function usePaletteModel() {
  useSignals()
  return {
    nodeCount: graph.nodeOrder.value.length,
    info: graph.info.value,
  }
}

export function useRightPanelModel() {
  useSignals()
  return {
    tab: graph.tab.value,
    historyCount: graph.history.value.length,
    activityCount: graph.activity.value.length,
  }
}
