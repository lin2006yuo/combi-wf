import {
  CanvasError,
  type CanvasDoc,
  type JobStatus,
  type NodeRegistry,
  type NodeRuntime,
  type ServerMessage,
} from '@combi/canvas-core'
import { randomId, sha1, stableStringify } from './util'

export interface JobView {
  id: string
  docId: string
  nodeId: string
  status: JobStatus
  progress: number
  createdAt: number
  finishedAt?: number
  error?: string
}

interface Job extends JobView {
  timers: Set<NodeJS.Timeout>
  waiters: Array<(runtime: NodeRuntime) => void>
}

interface ExecutionDeps {
  registry: NodeRegistry
  getDoc: (docId: string) => CanvasDoc
  emit: (docId: string, message: ServerMessage) => void
}

const TERMINAL: JobStatus[] = ['succeeded', 'failed', 'canceled']

/**
 * 模拟执行引擎。真实实现把 runNode 换成队列 + provider adapter，
 * 其余（状态机、签名、stale、取消、事件）保持同一套语义。
 */
export class ExecutionService {
  private readonly jobs = new Map<string, Job>()
  private readonly runtimes = new Map<string, Map<string, NodeRuntime>>()
  private readonly graphRunning = new Set<string>()

  constructor(private readonly deps: ExecutionDeps) {}

  runNode(docId: string, nodeId: string): string {
    const doc = this.deps.getDoc(docId)
    const node = doc.nodes[nodeId]
    if (!node) throw new CanvasError('NODE_NOT_FOUND', `节点不存在：${nodeId}`)
    const def = this.deps.registry.get(node.type)

    for (const port of def.inputs) {
      if (!port.required) continue
      const connected = Object.values(doc.edges).some(
        (edge) => edge.target === nodeId && edge.targetPort === port.id,
      )
      if (!connected) {
        throw new CanvasError(
          'INVALID_COMMAND',
          `「${node.data.label ?? def.title}」缺少必填输入「${port.label}」`,
        )
      }
    }

    this.cancelForNode(docId, nodeId, false)

    const job: Job = {
      id: randomId('job'),
      docId,
      nodeId,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      timers: new Set(),
      waiters: [],
    }
    this.jobs.set(job.id, job)
    this.pushRuntime(job)
    this.later(job, 260, () => {
      if (job.status !== 'queued') return
      job.status = 'running'
      job.progress = 4
      this.pushRuntime(job)
      this.tick(job)
    })
    return job.id
  }

  runNodeAndWait(docId: string, nodeId: string): Promise<NodeRuntime> {
    const jobId = this.runNode(docId, nodeId)
    const job = this.jobs.get(jobId)
    if (!job) throw new CanvasError('INVALID_COMMAND', '任务创建失败')
    if (TERMINAL.includes(job.status)) {
      const runtime = this.runtimeMap(docId).get(nodeId)
      if (runtime) return Promise.resolve(runtime)
    }
    return new Promise((resolve) => {
      job.waiters.push(resolve)
    })
  }

  async startGraph(docId: string, targetId?: string): Promise<{ nodes: string[] }> {
    if (this.graphRunning.has(docId)) {
      throw new CanvasError('INVALID_COMMAND', '已有工作流在运行中')
    }
    const doc = this.deps.getDoc(docId)
    const order = this.topologicalOrder(doc, targetId)
    if (order.length === 0) {
      throw new CanvasError('INVALID_COMMAND', '没有可运行的节点')
    }
    this.graphRunning.add(docId)
    void this.runGraphOrder(docId, order)
    return { nodes: order }
  }

  getJob(jobId: string): JobView | null {
    const job = this.jobs.get(jobId)
    if (!job) return null
    const { timers: _timers, waiters: _waiters, ...view } = job
    return view
  }

  getRuntime(docId: string): Record<string, NodeRuntime> {
    return Object.fromEntries(this.runtimeMap(docId))
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    return this.cancel(job)
  }

  cancelForNode(docId: string, nodeId: string, notify = true): void {
    for (const job of this.jobs.values()) {
      if (job.docId === docId && job.nodeId === nodeId && !TERMINAL.includes(job.status)) {
        this.cancel(job, notify)
      }
    }
  }

  /** 命令应用后：清理被删节点的 runtime、重算 stale。绝不写历史。 */
  syncAfterCommand(docId: string, affectedNodeIds: string[], affectedEdgeIds: string[]): void {
    void affectedEdgeIds
    const doc = this.deps.getDoc(docId)
    const runtime = this.runtimeMap(docId)
    for (const nodeId of [...runtime.keys()]) {
      if (!doc.nodes[nodeId]) {
        this.cancelForNode(docId, nodeId, false)
        runtime.delete(nodeId)
        this.deps.emit(docId, { type: 'runtime', nodeId, runtime: null })
      }
    }
    this.markAllStale(docId)
    void affectedNodeIds
  }

  shutdown(): void {
    for (const job of this.jobs.values()) {
      for (const timer of job.timers) clearTimeout(timer)
      job.timers.clear()
    }
  }

  private tick(job: Job): void {
    if (job.status !== 'running') return
    job.progress = Math.min(97, job.progress + 6 + Math.random() * 8)
    this.pushRuntime(job)
    if (job.progress >= 96) {
      this.later(job, 480, () => this.finish(job))
      return
    }
    this.later(job, 460, () => this.tick(job))
  }

  private finish(job: Job): void {
    if (job.status !== 'running') return
    const doc = this.deps.getDoc(job.docId)
    const node = doc.nodes[job.nodeId]
    if (!node) {
      this.cancel(job, false)
      return
    }
    const def = this.deps.registry.get(node.type)
    const kind = def.outputs.find((port) => port.type !== 'any')?.type ?? 'video'
    const signature = this.signature(job.docId, doc, job.nodeId)
    // 骨架阶段用本地 SVG 资产，避免依赖外网图床；真实实现换成对象存储 URL。
    const asset = mockAsset(job.nodeId, node.data.label ?? def.title, String(kind))

    job.status = 'succeeded'
    job.progress = 100
    job.finishedAt = Date.now()
    this.pushRuntime(job, {
      output: {
        kind: kind === 'any' ? 'video' : kind,
        url: asset,
        thumb: asset,
        hash: sha1(`${signature}:${job.finishedAt}:${Math.random()}`),
        inputSignature: signature,
        createdAt: job.finishedAt,
      },
    })
    this.markAllStale(job.docId)
    this.resolveWaiters(job)
  }

  private cancel(job: Job, notify = true): boolean {
    if (TERMINAL.includes(job.status)) return false
    for (const timer of job.timers) clearTimeout(timer)
    job.timers.clear()
    job.status = 'canceled'
    job.progress = Math.min(job.progress, 99)
    job.finishedAt = Date.now()
    if (notify) this.pushRuntime(job)
    this.resolveWaiters(job)
    return true
  }

  private resolveWaiters(job: Job): void {
    const runtime = this.runtimeMap(job.docId).get(job.nodeId)
    if (!runtime) return
    for (const resolve of job.waiters.splice(0)) resolve(runtime)
  }

  private async runGraphOrder(docId: string, order: string[]): Promise<void> {
    try {
      for (const nodeId of order) {
        if (!this.deps.getDoc(docId).nodes[nodeId]) continue
        try {
          const runtime = await this.runNodeAndWait(docId, nodeId)
          if (runtime.status !== 'succeeded') break
        } catch (error) {
          this.deps.emit(docId, {
            type: 'toast',
            level: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
          break
        }
      }
    } finally {
      this.graphRunning.delete(docId)
    }
  }

  private topologicalOrder(doc: CanvasDoc, targetId?: string): string[] {
    const subset = new Set<string>()
    if (targetId) {
      if (!doc.nodes[targetId]) {
        throw new CanvasError('NODE_NOT_FOUND', `节点不存在：${targetId}`)
      }
      const stack = [targetId]
      while (stack.length > 0) {
        const id = stack.pop() as string
        if (subset.has(id)) continue
        subset.add(id)
        for (const edge of Object.values(doc.edges)) {
          if (edge.target === id) stack.push(edge.source)
        }
      }
    } else {
      for (const id of doc.nodeOrder) subset.add(id)
    }

    const indegree = new Map<string, number>()
    const outgoing = new Map<string, string[]>()
    for (const id of subset) indegree.set(id, 0)
    for (const edge of Object.values(doc.edges)) {
      if (!subset.has(edge.source) || !subset.has(edge.target)) continue
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
      const list = outgoing.get(edge.source) ?? []
      list.push(edge.target)
      outgoing.set(edge.source, list)
    }

    const queue = doc.nodeOrder.filter((id) => subset.has(id) && (indegree.get(id) ?? 0) === 0)
    const order: string[] = []
    while (queue.length > 0) {
      const id = queue.shift() as string
      order.push(id)
      for (const next of outgoing.get(id) ?? []) {
        const value = (indegree.get(next) ?? 0) - 1
        indegree.set(next, value)
        if (value === 0) queue.push(next)
      }
    }
    if (order.length !== subset.size) {
      throw new CanvasError('CYCLE', '工作流中存在环，无法运行')
    }
    return order
  }

  private markAllStale(docId: string): void {
    const doc = this.deps.getDoc(docId)
    const runtime = this.runtimeMap(docId)
    for (const [nodeId, current] of runtime) {
      if (!current.output) continue
      const stale = this.signature(docId, doc, nodeId) !== current.output.inputSignature
      if (Boolean(current.stale) !== stale) {
        current.stale = stale
        current.updatedAt = Date.now()
        runtime.set(nodeId, current)
        this.deps.emit(docId, { type: 'runtime', nodeId, runtime: current })
      }
    }
  }

  private signature(docId: string, doc: CanvasDoc, nodeId: string): string {
    const node = doc.nodes[nodeId]
    if (!node) return ''
    const runtime = this.runtimeMap(docId)
    const inputs = doc.edgeOrder
      .map((edgeId) => doc.edges[edgeId])
      .filter((edge) => edge && edge.target === nodeId)
      .map((edge) => ({
        source: edge.source,
        port: edge.targetPort,
        output: runtime.get(edge.source)?.output?.hash ?? null,
      }))
    return sha1(stableStringify({ type: node.type, params: node.data.params, inputs }))
  }

  private runtimeMap(docId: string): Map<string, NodeRuntime> {
    let map = this.runtimes.get(docId)
    if (!map) {
      map = new Map()
      this.runtimes.set(docId, map)
    }
    return map
  }

  private pushRuntime(job: Job, overrides: Partial<NodeRuntime> = {}): void {
    const map = this.runtimeMap(job.docId)
    const previous = map.get(job.nodeId)
    const runtime: NodeRuntime = {
      nodeId: job.nodeId,
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      output: previous?.output,
      stale: previous?.stale,
      error: job.error,
      updatedAt: Date.now(),
      ...overrides,
    }
    map.set(job.nodeId, runtime)
    this.deps.emit(job.docId, { type: 'runtime', nodeId: job.nodeId, runtime })
  }

  private later(job: Job, ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      job.timers.delete(timer)
      fn()
    }, ms)
    job.timers.add(timer)
  }
}

const PALETTES = [
  ['#7c3aed', '#6366f1', '#22d3ee'],
  ['#f59e0b', '#ef4444', '#8b5cf6'],
  ['#10b981', '#06b6d4', '#4f46e5'],
  ['#ec4899', '#8b5cf6', '#22d3ee'],
]

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mockAsset(nodeId: string, label: string, kind: string): string {
  let hash = 0
  const seed = `${nodeId}:${label}:${kind}`
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  const palette = PALETTES[hash % PALETTES.length] ?? PALETTES[0]
  const [a, b, c] = palette
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="0.55" stop-color="${b}"/>
      <stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="r" cx="0.25" cy="0.15" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <rect width="640" height="360" fill="url(#r)"/>
  <circle cx="512" cy="292" r="190" fill="#05050a" opacity="0.22"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1">
    <circle cx="332" cy="176" r="58"/>
    <circle cx="332" cy="176" r="92" stroke-opacity="0.18"/>
  </g>
  <circle cx="332" cy="176" r="7" fill="#ffffff" fill-opacity="0.9"/>
  <text x="34" y="62" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="23" font-weight="600" fill="#ffffff" fill-opacity="0.92">${escapeXml(label)}</text>
  <text x="34" y="322" font-family="SF Mono, ui-monospace, monospace" font-size="13" letter-spacing="1.5" fill="#ffffff" fill-opacity="0.78">${escapeXml(kind.toUpperCase())} · MOCK OUTPUT</text>
  <rect x="34" y="292" width="42" height="3" rx="1.5" fill="#ffffff" fill-opacity="0.7"/>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
