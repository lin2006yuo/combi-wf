export type NodeId = string
export type EdgeId = string

export interface Vec2 {
  x: number
  y: number
}

/** 端口/资产的媒体类型。any 只用于适配器类节点。 */
export type MediaType = 'image' | 'video' | 'audio' | 'text' | 'any'

/** 命令来源。undo 是独立来源，用来防止 agent / 同步逻辑把撤销当成用户操作。 */
export type Source = 'user' | 'agent' | 'undo' | 'system'

export interface CanvasNode {
  id: NodeId
  type: string
  position: Vec2
  data: {
    label?: string
    params: Record<string, unknown>
  }
}

export interface CanvasEdge {
  id: EdgeId
  source: NodeId
  sourcePort: string
  target: NodeId
  targetPort: string
}

/**
 * 文档面：唯一进入 undo 历史的东西。
 * 运行时状态（job/progress/output）不在这里，见 NodeRuntime。
 */
export interface CanvasDoc {
  id: string
  rev: number
  nodes: Record<NodeId, CanvasNode>
  edges: Record<EdgeId, CanvasEdge>
  nodeOrder: NodeId[]
  edgeOrder: EdgeId[]
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface NodeOutput {
  kind: Exclude<MediaType, 'any'>
  url: string
  thumb?: string
  hash: string
  /** 产出时输入（参数 + 上游输出 hash）的签名，用于派生 stale，不进历史。 */
  inputSignature: string
  createdAt: number
}

/** 执行面：只通过事件/WS 推送，永不写进 CanvasDoc 或 HistoryEntry。 */
export interface NodeRuntime {
  nodeId: NodeId
  jobId?: string
  status: JobStatus
  progress: number
  output?: NodeOutput
  error?: string
  stale?: boolean
  updatedAt: number
}
