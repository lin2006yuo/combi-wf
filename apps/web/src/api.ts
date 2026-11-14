export const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://127.0.0.1:8787'
export const CANVAS_TOKEN = (import.meta.env.VITE_CANVAS_TOKEN as string | undefined) ?? ''
export const DOC_ID = 'main'
export const MCP_URL = `${SERVER_URL}/mcp/${DOC_ID}`

export interface ServerInfo {
  mcpPath: string
  docId: string
  tokenRequired: boolean
  nodeTypes: Array<{
    type: string
    title: string
    category: string
    description: string
  }>
}

export function authHeaders(): Record<string, string> {
  return CANVAS_TOKEN ? { authorization: `Bearer ${CANVAS_TOKEN}` } : {}
}

export async function fetchInfo(): Promise<ServerInfo> {
  const response = await fetch(`${SERVER_URL}/api/info`, { headers: authHeaders() })
  if (!response.ok) throw new Error(`info ${response.status}`)
  return (await response.json()) as ServerInfo
}
