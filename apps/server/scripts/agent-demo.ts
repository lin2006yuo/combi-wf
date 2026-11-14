/**
 * 端到端验收脚本：模拟一个外部 agent 通过 MCP 操作画布。
 * 用法：先启动 server（pnpm --filter @combi/server dev），再运行：
 *   pnpm agent:demo
 */
import { existsSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

for (const candidate of ['../../.env', '.env']) {
  if (!existsSync(candidate)) continue
  try {
    process.loadEnvFile(candidate)
  } catch {
    // ignore
  }
}

const url = process.env.MCP_URL ?? 'http://127.0.0.1:8787/mcp/main'
const token = process.env.CANVAS_TOKEN ?? process.env.MCP_TOKEN
const headers: Record<string, string> = {
  'x-actor-id': 'agent:demo',
}
if (token) headers.authorization = `Bearer ${token}`

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers },
})
const client = new Client({ name: 'combi-demo-agent', version: '0.1.0' })

function parse(result: unknown): unknown {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content
  const first = content?.find((item) => item.type === 'text')
  if (!first?.text) return result
  try {
    return JSON.parse(first.text)
  } catch {
    return first.text
  }
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  if ((result as { isError?: boolean }).isError) {
    throw new Error(`tool ${name} failed: ${String(parse(result))}`)
  }
  return parse(result)
}

async function main() {
  await client.connect(transport)
  console.log(`connected to ${url}`)

  const tools = await client.listTools()
  console.log(
    'tools:',
    tools.tools.map((tool) => tool.name).join(', '),
  )

  const before = (await call('get_canvas')) as { rev: number; nodes: unknown[] }
  console.log(`canvas rev=${before.rev}, nodes=${before.nodes.length}`)

  const nodeTypes = (await call('list_node_types')) as Array<{ type: string }>
  console.log('node types:', nodeTypes.map((item) => item.type).join(', '))

  const batch = await call('batch', {
    label: 'agent 搭建演示链路',
    clientRequestId: 'demo-batch-1',
    operations: [
      {
        type: 'node.add',
        payload: {
          node: {
            id: 'n_agent_img',
            type: 'image.gen',
            position: { x: 120, y: 560 },
            params: { prompt: '一只戴宇航头盔的柴犬，胶片质感' },
            label: 'Agent 图片',
          },
        },
      },
      {
        type: 'node.add',
        payload: {
          node: {
            id: 'n_agent_vid',
            type: 'video.gen',
            position: { x: 500, y: 560 },
            params: { prompt: '柴犬缓慢转头，镜头环绕', duration: 5 },
            label: 'Agent 视频',
          },
        },
      },
      {
        type: 'edge.connect',
        payload: {
          source: 'n_agent_img',
          sourcePort: 'image',
          target: 'n_agent_vid',
          targetPort: 'firstFrame',
        },
      },
    ],
  })
  console.log('batch:', JSON.stringify(batch, null, 2))

  const run = (await call('run_node', { nodeId: 'n_agent_img' })) as { jobId: string }
  console.log('run_node:', run)

  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    const job = (await call('get_job', { jobId: run.jobId })) as {
      status: string
      progress: number
    }
    console.log(`job ${job.status} ${Math.round(job.progress)}%`)
    if (['succeeded', 'failed', 'canceled'].includes(job.status)) break
  }

  const after = (await call('get_canvas')) as {
    rev: number
    nodes: Array<{ id: string; runtime: { status: string; output: { url: string } | null } | null }>
  }
  console.log(`canvas rev=${after.rev}, nodes=${after.nodes.length}`)
  console.log(
    'agent nodes:',
    JSON.stringify(
      after.nodes.filter((node) => node.id.startsWith('n_agent')),
      null,
      2,
    ),
  )

  await client.close()
}

main().catch(async (error) => {
  console.error(error)
  await client.close().catch(() => undefined)
  process.exit(1)
})
