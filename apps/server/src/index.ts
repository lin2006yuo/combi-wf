import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  createDefaultRegistry,
  isCanvasError,
  type ClientMessage,
} from '@combi/canvas-core'
import { config } from './config'
import { DocStore } from './store'
import { Hub } from './hub'
import { ExecutionService } from './execution'
import { CanvasService } from './service'
import { createMcpServer } from './mcp'
import { sanitizeDocId } from './util'

const registry = createDefaultRegistry()
const store = new DocStore(config.dataDir, registry)
const hub = new Hub()
const execution = new ExecutionService({
  registry,
  getDoc: (docId) => store.get(docId).getDoc(),
  emit: (docId, message) => hub.broadcast(docId, message),
})
const service = new CanvasService(store, execution, hub)

const app = Fastify({ logger: true })

await app.register(cors, { origin: true, exposedHeaders: ['Mcp-Session-Id'] })
await app.register(websocket)

function bearer(value: string | undefined): string | undefined {
  if (!value?.startsWith('Bearer ')) return undefined
  return value.slice('Bearer '.length)
}

function authorized(request: FastifyRequest): boolean {
  if (!config.token) return true
  const url = new URL(request.url, 'http://localhost')
  const token = bearer(request.headers.authorization) ?? url.searchParams.get('token') ?? undefined
  return token === config.token
}

function sendError(reply: FastifyReply, error: unknown) {
  if (isCanvasError(error)) {
    return reply.code(400).send({ error: { code: error.code, message: error.message } })
  }
  app.log.error(error)
  return reply.code(500).send({ error: { code: 'INTERNAL', message: '服务器内部错误' } })
}

app.get('/api/health', async () => ({
  ok: true,
  uptime: process.uptime(),
}))

app.get('/api/info', async () => ({
  mcpPath: '/mcp/main',
  docId: 'main',
  tokenRequired: Boolean(config.token),
  nodeTypes: registry.list().map((def) => ({
    type: def.type,
    title: def.title,
    category: def.category,
    description: def.description,
  })),
}))

app.get<{ Params: { docId: string } }>('/api/docs/:docId', async (request, reply) => {
  if (!authorized(request)) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: '缺少或错误的 token' } })
  }
  try {
    return service.getSnapshot(request.params.docId)
  } catch (error) {
    return sendError(reply, error)
  }
})

app.get<{ Params: { docId: string } }>('/api/docs/:docId/runtime', async (request, reply) => {
  if (!authorized(request)) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: '缺少或错误的 token' } })
  }
  try {
    return { runtime: service.getRuntime(request.params.docId) }
  } catch (error) {
    return sendError(reply, error)
  }
})

app.post<{ Params: { docId: string }; Body: { command?: unknown } }>(
  '/api/docs/:docId/commands',
  async (request, reply) => {
    if (!authorized(request)) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: '缺少或错误的 token' } })
    }
    const actorId = String(request.headers['x-actor-id'] ?? 'http:client')
    try {
      const response = await service.execute(request.params.docId, request.body?.command, {
        source: 'user',
        actorId,
      })
      if (response.kind === 'run') return { ok: true, data: response.data }
      return { ok: true, result: response.result }
    } catch (error) {
      return sendError(reply, error)
    }
  },
)

app.get('/ws', { websocket: true }, (socket, request) => {
  const url = new URL(request.url, 'http://localhost')
  if (!authorized(request)) {
    socket.close(1008, 'unauthorized')
    return
  }

  let docId: string
  try {
    docId = sanitizeDocId(url.searchParams.get('docId'))
  } catch {
    socket.close(1008, 'bad doc id')
    return
  }

  const clientId = url.searchParams.get('clientId') ?? 'web'
  const actorId = `user:${clientId}`
  hub.add(docId, socket)
  hub.send(socket, service.getSnapshot(docId))

  socket.on('message', (raw) => {
    void (async () => {
      let message: ClientMessage
      try {
        message = JSON.parse(raw.toString()) as ClientMessage
      } catch {
        return
      }

      if (message.type === 'ping') {
        hub.send(socket, { type: 'toast', level: 'info', message: 'pong' })
        return
      }

      if (message.type === 'resync') {
        hub.send(socket, service.getSnapshot(docId))
        return
      }

      if (message.type !== 'command') return
      const requestId = typeof message.requestId === 'string' ? message.requestId : undefined
      try {
        const response = await service.execute(docId, message.command, {
          source: 'user',
          actorId,
          requestId,
        })
        if (response.kind === 'run') {
          hub.send(socket, { type: 'command.result', requestId, data: response.data })
        }
      } catch (error) {
        const code = isCanvasError(error) ? error.code : 'INTERNAL'
        const text = error instanceof Error ? error.message : String(error)
        hub.send(socket, { type: 'command.error', requestId, error: { code, message: text } })
      }
    })()
  })

  socket.on('close', () => hub.remove(docId, socket))
  socket.on('error', () => hub.remove(docId, socket))
})

app.all<{ Params: { docId: string } }>('/mcp/:docId', async (request, reply) => {
  if (!authorized(request)) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: '缺少或错误的 token' } })
  }

  let docId: string
  try {
    docId = sanitizeDocId(request.params.docId)
  } catch (error) {
    return sendError(reply, error)
  }

  const actorId = String(request.headers['x-actor-id'] ?? 'agent:external')
  const mcp = createMcpServer(service, registry, docId, actorId)
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  })

  reply.hijack()
  try {
    await mcp.connect(transport)
    await transport.handleRequest(request.raw, reply.raw, request.body)
  } catch (error) {
    app.log.error(error)
    if (!reply.raw.headersSent) {
      reply.raw.statusCode = 500
      reply.raw.setHeader('content-type', 'application/json')
      reply.raw.end(
        JSON.stringify({ error: { code: 'INTERNAL', message: 'MCP 请求处理失败' } }),
      )
    }
  } finally {
    await transport.close().catch(() => undefined)
    await mcp.close().catch(() => undefined)
  }
})

await store.init()
// 首次启动时把示例画布落盘
service.getSnapshot('main')

await app.listen({ port: config.port, host: config.host })
app.log.info(`canvas server  http://${config.host}:${config.port}`)
app.log.info(`mcp endpoint   http://${config.host}:${config.port}/mcp/main`)
app.log.info(`token required ${Boolean(config.token)}`)

async function shutdown() {
  execution.shutdown()
  await store.flush()
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
