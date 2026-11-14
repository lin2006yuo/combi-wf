import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CanvasError,
  type Command,
  type DocumentCommand,
  type NodeRegistry,
} from '@combi/canvas-core'
import type { CanvasService } from './service'

const text = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
})

const failure = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
})

function formatError(error: unknown): string {
  if (error instanceof CanvasError) return `[${error.code}] ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

async function guard(fn: () => Promise<unknown> | unknown) {
  try {
    return text(await fn())
  } catch (error) {
    return failure(formatError(error))
  }
}

const opTypes = [
  'node.add',
  'node.move',
  'node.update',
  'node.delete',
  'edge.connect',
  'edge.disconnect',
] as const

/**
 * 外部 agent 的入口。每个工具都只是 Command 生产者，
 * 和 UI 共用校验、历史、审计与预算入口。
 */
export function createMcpServer(
  service: CanvasService,
  registry: NodeRegistry,
  docId: string,
  actorId: string,
): McpServer {
  const server = new McpServer({ name: 'combi-canvas', version: '0.1.0' })

  const execute = (command: Command) =>
    service.execute(docId, command, { source: 'agent', actorId })

  server.registerTool(
    'get_canvas',
    {
      title: '读取画布',
      description:
        '返回当前画布的节点、连线、节点参数与运行时状态（含 stale）。写操作前先调用它确认现状。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      guard(async () => {
        const snapshot = service.getSnapshot(docId)
        const history = service.getHistory(docId)
        return {
          docId,
          rev: snapshot.doc.rev,
          nodes: snapshot.doc.nodeOrder.map((id) => {
            const node = snapshot.doc.nodes[id]
            const runtime = snapshot.runtime[id]
            return {
              id,
              type: node.type,
              label: node.data.label,
              position: node.position,
              params: node.data.params,
              runtime: runtime
                ? {
                    status: runtime.status,
                    progress: runtime.progress,
                    stale: Boolean(runtime.stale),
                    jobId: runtime.jobId,
                    output: runtime.output
                      ? {
                          kind: runtime.output.kind,
                          url: runtime.output.url,
                          thumb: runtime.output.thumb,
                        }
                      : null,
                  }
                : null,
            }
          }),
          edges: snapshot.doc.edgeOrder.map((id) => {
            const edge = snapshot.doc.edges[id]
            return {
              id,
              source: edge.source,
              sourcePort: edge.sourcePort,
              target: edge.target,
              targetPort: edge.targetPort,
            }
          }),
          history: {
            entries: history.entries.length,
            cursor: history.cursor,
            canUndo: history.cursor > 0,
            canRedo: history.cursor < history.entries.length,
          },
        }
      }),
  )

  server.registerTool(
    'get_node',
    {
      title: '读取单个节点',
      description: '返回单个节点的参数、端口与运行时状态。',
      inputSchema: { nodeId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ nodeId }) =>
      guard(async () => {
        const snapshot = service.getSnapshot(docId)
        const node = snapshot.doc.nodes[nodeId]
        if (!node) throw new CanvasError('NODE_NOT_FOUND', `节点不存在：${nodeId}`)
        return { node, runtime: snapshot.runtime[nodeId] ?? null }
      }),
  )

  server.registerTool(
    'list_node_types',
    {
      title: '列出节点类型',
      description:
        '返回可用节点类型、端口、参数 JSON Schema 与说明。add_node / update_node 之前先用它了解 schema。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      guard(async () =>
        registry.list().map((def) => ({
          type: def.type,
          title: def.title,
          category: def.category,
          description: def.description,
          inputs: def.inputs,
          outputs: def.outputs,
          defaults: def.defaults,
          paramsSchema: zodToJsonSchema(def.params),
        })),
      ),
  )

  server.registerTool(
    'add_node',
    {
      title: '添加节点',
      description:
        '在画布上添加一个节点。type 必须来自 list_node_types；params 会与默认值合并并校验。',
      inputSchema: {
        type: z.string().describe('节点类型，例如 image.gen / video.gen / compose'),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        params: z.record(z.unknown()).optional(),
        label: z.string().optional(),
        clientRequestId: z.string().optional().describe('幂等键，重试时复用'),
      },
    },
    async (args) =>
      guard(async () => {
        const result = await execute({
          id: args.clientRequestId,
          type: 'node.add',
          payload: {
            node: {
              type: args.type,
              position: args.position,
              params: args.params,
              label: args.label,
            },
          },
        })
        return summarize(result)
      }),
  )

  server.registerTool(
    'update_node',
    {
      title: '修改节点',
      description: '修改节点参数或标签；params 是局部更新，会与现有参数合并后按 schema 校验。',
      inputSchema: {
        nodeId: z.string(),
        params: z.record(z.unknown()).optional(),
        label: z.string().optional(),
        clientRequestId: z.string().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const result = await execute({
          id: args.clientRequestId,
          type: 'node.update',
          payload: { id: args.nodeId, params: args.params, label: args.label },
        })
        return summarize(result)
      }),
  )

  server.registerTool(
    'move_nodes',
    {
      title: '移动节点',
      description: '一次移动一个或多个节点。整次调用只产生一条历史记录。',
      inputSchema: {
        moves: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })),
        clientRequestId: z.string().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const result = await execute({
          id: args.clientRequestId,
          type: 'node.move',
          payload: {
            moves: args.moves.map((move) => ({
              id: move.id,
              position: { x: move.x, y: move.y },
            })),
          },
        })
        return summarize(result)
      }),
  )

  server.registerTool(
    'connect',
    {
      title: '连接节点',
      description:
        '连接两个端口。sourcePort / targetPort 省略时使用该节点的第一个输出/输入。类型不匹配、成环、端口占用会被拒绝。',
      inputSchema: {
        source: z.string(),
        sourcePort: z.string().optional(),
        target: z.string(),
        targetPort: z.string().optional(),
        clientRequestId: z.string().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const result = await execute({
          id: args.clientRequestId,
          type: 'edge.connect',
          payload: {
            source: args.source,
            sourcePort: args.sourcePort,
            target: args.target,
            targetPort: args.targetPort,
          },
        })
        return summarize(result)
      }),
  )

  server.registerTool(
    'disconnect',
    {
      title: '删除连线',
      description: '按 id 删除一条或多条连线。',
      inputSchema: {
        ids: z.array(z.string()),
        clientRequestId: z.string().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const result = await execute({
          id: args.clientRequestId,
          type: 'edge.disconnect',
          payload: { ids: args.ids },
        })
        return summarize(result)
      }),
  )

  server.registerTool(
    'delete_nodes',
    {
      title: '删除节点',
      description: '删除节点并级联删除相关连线。此操作可由用户 Ctrl+Z 撤销。',
      inputSchema: {
        ids: z.array(z.string()),
        clientRequestId: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async (args) =>
      guard(async () => {
        const result = await execute({
          id: args.clientRequestId,
          type: 'node.delete',
          payload: { ids: args.ids },
        })
        return summarize(result)
      }),
  )

  server.registerTool(
    'batch',
    {
      title: '批量操作',
      description:
        '把多个文档操作作为一个原子事务执行，只产生一条历史记录。适合「搭建一条链路」「整理布局」这类多步意图。',
      inputSchema: {
        operations: z.array(
          z.object({
            type: z.enum(opTypes),
            payload: z.record(z.unknown()).optional(),
          }),
        ),
        label: z.string().optional().describe('历史面板展示的意图文案'),
        clientRequestId: z.string().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const ops = args.operations.map(
          (op) => ({ type: op.type, payload: op.payload ?? {} }) as DocumentCommand,
        )
        const result = await execute({
          id: args.clientRequestId,
          type: 'batch',
          label: args.label,
          payload: { ops },
        })
        return summarize(result)
      }),
  )

  server.registerTool(
    'run_node',
    {
      title: '运行单个节点',
      description: '立即返回 jobId；用 get_job 轮询状态。会校验必填输入。',
      inputSchema: { nodeId: z.string() },
    },
    async ({ nodeId }) =>
      guard(async () => {
        const result = await execute({ type: 'node.run', payload: { id: nodeId } })
        return result.kind === 'run' ? result.data : null
      }),
  )

  server.registerTool(
    'run_graph',
    {
      title: '运行工作流',
      description:
        '按拓扑序异步运行整张图，或 targetId 的上游子图。立即返回节点顺序；用 get_canvas / get_job 观察进度。',
      inputSchema: { targetId: z.string().optional() },
    },
    async ({ targetId }) =>
      guard(async () => {
        const result = await execute({ type: 'graph.run', payload: { targetId } })
        return result.kind === 'run' ? result.data : null
      }),
  )

  server.registerTool(
    'get_job',
    {
      title: '查询任务',
      description: '查询异步生成任务的状态与进度。',
      inputSchema: { jobId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ jobId }) =>
      guard(async () => {
        const job = service.getJob(jobId)
        if (!job) throw new CanvasError('NODE_NOT_FOUND', `任务不存在：${jobId}`)
        return job
      }),
  )

  server.registerTool(
    'cancel_job',
    {
      title: '取消任务',
      description: '取消一个排队或运行中的生成任务。',
      inputSchema: { jobId: z.string() },
    },
    async ({ jobId }) =>
      guard(async () => {
        const result = await execute({ type: 'job.cancel', payload: { jobId } })
        return result.kind === 'run' ? result.data : null
      }),
  )

  server.registerTool(
    'undo_my_last',
    {
      title: '撤销本 agent 的最后一步',
      description:
        '只允许撤销本 agent 创建的最近一条历史。若最近一条是用户操作，会被拒绝，避免误伤。',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const history = service.getHistory(docId)
        const top = history.entries[history.cursor - 1]
        if (!top) throw new CanvasError('NOTHING_TO_UNDO', '没有可撤销的操作')
        if (top.source !== 'agent' || top.actorId !== actorId) {
          throw new CanvasError(
            'OUT_OF_ORDER_UNDO',
            '最近一条历史不是本 agent 的操作；请让用户在界面上撤销',
          )
        }
        const result = await service.execute(
          docId,
          { type: 'history.undo' },
          { source: 'undo', actorId },
        )
        return summarize(result)
      }),
  )

  return server
}

function summarize(result: Awaited<ReturnType<CanvasService['execute']>>) {
  if (result.kind === 'run') return result.data
  return {
    commandId: result.result.commandId,
    rev: result.result.rev,
    changed: result.result.changed,
    label: result.result.entry?.label,
    affected: result.result.affected,
    created: result.result.created,
    history: result.result.history
      ? { cursor: result.result.history.cursor, entries: result.result.history.entries.length }
      : undefined,
  }
}
