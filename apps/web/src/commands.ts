import type { Vec2 } from '@combi/canvas-core'
import { sendCommand } from './ws'
import { useAppStore } from './store'

export function toastError(error: unknown, fallback = '操作失败'): void {
  const message = error instanceof Error ? error.message : String(error)
  useAppStore.getState().toast(message || fallback, 'error')
}

export async function addNode(type: string, position: Vec2): Promise<string | null> {
  try {
    const response = await sendCommand({
      type: 'node.add',
      payload: { node: { type, position } },
    })
    if ('created' in response) {
      const created = response.created.nodes[0] ?? null
      if (created) useAppStore.getState().select(created)
      return created
    }
    return null
  } catch (error) {
    toastError(error, '添加节点失败')
    return null
  }
}

export async function moveNodes(
  moves: Array<{ id: string; position: Vec2 }>,
): Promise<boolean> {
  try {
    await sendCommand({ type: 'node.move', payload: { moves } })
    return true
  } catch (error) {
    toastError(error, '移动节点失败')
    return false
  }
}

export async function updateNode(
  id: string,
  params?: Record<string, unknown>,
  label?: string,
): Promise<boolean> {
  try {
    await sendCommand({ type: 'node.update', payload: { id, params, label } })
    return true
  } catch (error) {
    toastError(error, '修改节点失败')
    return false
  }
}

export async function deleteNodes(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    await sendCommand({ type: 'node.delete', payload: { ids } })
    const state = useAppStore.getState()
    if (state.selectedIds.some((id) => ids.includes(id))) state.select(null)
    state.toast(ids.length === 1 ? '已删除节点' : `已删除 ${ids.length} 个节点`, 'info')
  } catch (error) {
    toastError(error, '删除节点失败')
  }
}

export async function connectPorts(
  source: string,
  sourcePort: string | null,
  target: string,
  targetPort: string | null,
): Promise<void> {
  try {
    await sendCommand({
      type: 'edge.connect',
      payload: {
        source,
        sourcePort: sourcePort ?? undefined,
        target,
        targetPort: targetPort ?? undefined,
      },
    })
  } catch (error) {
    toastError(error, '连接失败')
  }
}

export async function undo(): Promise<void> {
  const state = useAppStore.getState()
  if (state.cursor <= 0) return
  try {
    await sendCommand({ type: 'history.undo' })
  } catch (error) {
    toastError(error, '撤销失败')
  }
}

export async function redo(): Promise<void> {
  const state = useAppStore.getState()
  if (state.cursor >= state.history.length) return
  try {
    await sendCommand({ type: 'history.redo' })
  } catch (error) {
    toastError(error, '重做失败')
  }
}

export async function runNode(id: string): Promise<void> {
  try {
    await sendCommand({ type: 'node.run', payload: { id } })
    useAppStore.getState().toast('已提交生成任务', 'info')
  } catch (error) {
    toastError(error, '运行失败')
  }
}

export async function runGraph(): Promise<void> {
  try {
    const response = await sendCommand({ type: 'graph.run', payload: {} })
    if ('data' in response) {
      const data = response.data as { nodes?: string[] }
      useAppStore
        .getState()
        .toast(`开始运行 ${data.nodes?.length ?? 0} 个节点`, 'info')
    }
  } catch (error) {
    toastError(error, '运行工作流失败')
  }
}
