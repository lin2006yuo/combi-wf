import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '../store'
import { registry } from '../registry'
import { connectPorts, deleteNodes, moveNodes, redo, undo } from '../commands'
import { sendCommand } from '../ws'
import { FlowNode, type WorkflowNode, type WorkflowNodeData } from './FlowNode'

const nodeTypes = {
  'image.gen': FlowNode,
  'video.gen': FlowNode,
  compose: FlowNode,
}

const EDGE_STYLE = {
  stroke: 'rgba(150, 150, 185, 0.55)',
  strokeWidth: 1.6,
}

export function Canvas() {
  const doc = useAppStore((state) => state.doc)
  const runtime = useAppStore((state) => state.runtime)
  const selectedIds = useAppStore((state) => state.selectedIds)
  const dragPositions = useAppStore((state) => state.dragPositions)
  const [measured, setMeasured] = useState<Record<string, { width?: number; height?: number }>>({})

  const nodes = useMemo<WorkflowNode[]>(() => {
    if (!doc) return []
    return doc.nodeOrder.map((id) => {
      const node = doc.nodes[id]
      const def = registry.get(node.type)
      return {
        id,
        type: node.type,
        position: dragPositions[id] ?? node.position,
        selected: selectedIds.includes(id),
        measured: measured[id],
        data: {
          label: node.data.label ?? def.title,
          nodeType: node.type,
          params: node.data.params,
          runtime: runtime[id] ?? null,
        },
      }
    })
  }, [doc, dragPositions, selectedIds, runtime, measured])

  const edges = useMemo<Edge[]>(() => {
    if (!doc) return []
    return doc.edgeOrder.map((id) => {
      const edge = doc.edges[id]
      const busy = runtime[edge.source]?.status === 'running'
      return {
        id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourcePort,
        targetHandle: edge.targetPort,
        type: 'smoothstep',
        animated: busy,
        style: EDGE_STYLE,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'rgba(150, 150, 185, 0.7)',
          width: 16,
          height: 16,
        },
      }
    })
  }, [doc, runtime])

  const onNodesChange = useCallback((changes: NodeChange<WorkflowNode>[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        useAppStore.getState().setDrag(change.id, change.position)
      } else if (change.type === 'dimensions' && change.dimensions) {
        const dimensions = change.dimensions
        setMeasured((previous) => ({ ...previous, [change.id]: dimensions }))
      }
    }
  }, [])

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (!doc) return false
      const source = doc.nodes[connection.source]
      const target = doc.nodes[connection.target]
      if (!source || !target || source.id === target.id) return false
      const sourcePort = registry
        .get(source.type)
        .outputs.find((port) => port.id === connection.sourceHandle)
      const targetPort = registry
        .get(target.type)
        .inputs.find((port) => port.id === connection.targetHandle)
      if (!sourcePort || !targetPort) return false
      return (
        sourcePort.type === targetPort.type ||
        sourcePort.type === 'any' ||
        targetPort.type === 'any'
      )
    },
    [doc],
  )

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    void connectPorts(
      connection.source,
      connection.sourceHandle ?? null,
      connection.target,
      connection.targetHandle ?? null,
    )
  }, [])

  const onNodeDragStop = useCallback(
    async (
      _event: MouseEvent | TouchEvent,
      node: WorkflowNode,
      allNodes: WorkflowNode[],
    ) => {
      const state = useAppStore.getState()
      const ids = state.selectedIds.includes(node.id) ? state.selectedIds : [node.id]
      const moves = ids.map((id) => {
        const found = allNodes.find((item) => item.id === id)
        return {
          id,
          position: state.dragPositions[id] ?? found?.position ?? node.position,
        }
      })
      await moveNodes(moves)
      useAppStore.getState().clearDrag(ids)
    },
    [],
  )

  const onEdgeDoubleClick = useCallback(async (_event: ReactMouseEvent, edge: Edge) => {
    try {
      await sendCommand({ type: 'edge.disconnect', payload: { ids: [edge.id] } })
      useAppStore.getState().toast('已删除连线', 'info')
    } catch (error) {
      useAppStore
        .getState()
        .toast(error instanceof Error ? error.message : '删除连线失败', 'error')
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) void redo()
        else void undo()
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        void redo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const ids = useAppStore.getState().selectedIds
        if (ids.length > 0) {
          event.preventDefault()
          void deleteNodes(ids)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const minimapColor = useCallback((node: WorkflowNode) => {
    const data = node.data as WorkflowNodeData
    return registry.get(data.nodeType).ui.accent
  }, [])

  return (
    <main className="canvas-shell">
      <ReactFlow<WorkflowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(event, node) =>
          useAppStore.getState().select(node.id, event.shiftKey)
        }
        onPaneClick={() => useAppStore.getState().select(null)}
        onEdgeDoubleClick={onEdgeDoubleClick}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.25}
        maxZoom={1.75}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep', style: EDGE_STYLE }}
        connectionLineStyle={{ stroke: '#8b5cf6', strokeWidth: 1.8 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="rgba(255,255,255,0.10)"
        />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          nodeColor={minimapColor}
          nodeStrokeColor={minimapColor}
          maskColor="rgba(8, 8, 14, 0.75)"
          pannable
          zoomable
          position="bottom-right"
          style={{ width: 168, height: 110 }}
        />
      </ReactFlow>

      {nodes.length === 0 ? (
        <div className="canvas-empty">
          <div className="canvas-empty-title">画布是空的</div>
          <div className="canvas-empty-sub">从左侧节点库添加一个图片节点开始</div>
        </div>
      ) : null}

      <div className="canvas-hint">
        拖拽节点 · 从端口拉线 · 双击连线删除 · ⌘Z 撤销
      </div>
    </main>
  )
}
