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
import { registry } from '../registry'
import { connectPorts, deleteNodes, moveNodes, redo, undo } from '../commands'
import { sendCommand } from '../ws'
import { graph } from '../graph/state'
import { useCanvasModel } from '../graph/hooks'
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

const EMPTY_DATA: WorkflowNodeData = {}

export function Canvas() {
  const { nodeOrder, edgeOrder, views, edgeViews, dragPositions, selectedIds } = useCanvasModel()
  const [measured, setMeasured] = useState<Record<string, { width?: number; height?: number }>>({})

  const nodes = useMemo<WorkflowNode[]>(() => {
    return nodeOrder.flatMap((id) => {
      const view = views[id]
      if (!view) return []
      return [
        {
          id,
          type: view.type,
          position: dragPositions[id] ?? view.position,
          selected: selectedIds.includes(id),
          measured: measured[id],
          data: EMPTY_DATA,
        },
      ]
    })
  }, [nodeOrder, views, dragPositions, selectedIds, measured])

  const edges = useMemo<Edge[]>(() => {
    return edgeOrder.flatMap((id) => {
      const edge = edgeViews[id]
      if (!edge) return []
      return [
        {
          id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourcePort,
          targetHandle: edge.targetPort,
          type: 'smoothstep',
          style: EDGE_STYLE,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'rgba(150, 150, 185, 0.7)',
            width: 16,
            height: 16,
          },
        },
      ]
    })
  }, [edgeOrder, edgeViews])

  const onNodesChange = useCallback((changes: NodeChange<WorkflowNode>[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        graph.setDrag(change.id, change.position)
      } else if (change.type === 'dimensions' && change.dimensions) {
        const dimensions = change.dimensions
        setMeasured((previous) => ({ ...previous, [change.id]: dimensions }))
      }
    }
  }, [])

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const source = graph.getNode(connection.source)
    const target = graph.getNode(connection.target)
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
  }, [])

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
    async (_event: MouseEvent | TouchEvent, node: WorkflowNode, allNodes: WorkflowNode[]) => {
      const selected = graph.selectedIds.value
      const ids = selected.includes(node.id) ? selected : [node.id]
      const moves = ids.map((id) => {
        const found = allNodes.find((item) => item.id === id)
        return {
          id,
          position: graph.dragPositions.value[id] ?? found?.position ?? node.position,
        }
      })
      await moveNodes(moves)
      graph.clearDrag(ids)
    },
    [],
  )

  const onEdgeDoubleClick = useCallback(async (_event: ReactMouseEvent, edge: Edge) => {
    try {
      await sendCommand({ type: 'edge.disconnect', payload: { ids: [edge.id] } })
      graph.toast('已删除连线', 'info')
    } catch (error) {
      graph.toast(error instanceof Error ? error.message : '删除连线失败', 'error')
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
        const ids = graph.selectedIds.value
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
    return registry.get(node.type ?? 'image.gen').ui.accent
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
        onNodeClick={(event, node) => graph.select(node.id, event.shiftKey)}
        onPaneClick={() => graph.select(null)}
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

      {nodeOrder.length === 0 ? (
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
