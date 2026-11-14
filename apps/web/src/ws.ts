import type {
  AppliedMessage,
  ClientMessage,
  Command,
  CommandResultMessage,
  ServerMessage,
} from '@combi/canvas-core'
import { CANVAS_TOKEN, DOC_ID, SERVER_URL } from './api'
import { useAppStore } from './store'

type Resolved = AppliedMessage | CommandResultMessage

interface Pending {
  resolve: (message: Resolved) => void
  reject: (error: Error) => void
  timer: number
}

let socket: WebSocket | null = null
let started = false
let attempts = 0
let reconnectTimer: number | null = null
const pending = new Map<string, Pending>()

function clientId(): string {
  const key = 'combi.clientId'
  let value = localStorage.getItem(key)
  if (!value) {
    value = Math.random().toString(36).slice(2, 8)
    localStorage.setItem(key, value)
  }
  return value
}

function websocketUrl(): string {
  const base = SERVER_URL.replace(/^http/, 'ws')
  const params = new URLSearchParams({ docId: DOC_ID, clientId: clientId() })
  if (CANVAS_TOKEN) params.set('token', CANVAS_TOKEN)
  return `${base}/ws?${params.toString()}`
}

export function startConnection(): void {
  if (started) return
  started = true
  open()
}

function open(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }
  const store = useAppStore.getState()
  store.setStatus('connecting')

  const ws = new WebSocket(websocketUrl())
  socket = ws

  ws.onopen = () => {
    attempts = 0
    useAppStore.getState().setStatus('open')
  }

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(String(event.data)) as ServerMessage)
    } catch (error) {
      console.warn('bad server message', error)
    }
  }

  ws.onclose = () => {
    if (socket === ws) socket = null
    useAppStore.getState().setStatus('closed')
    rejectAll(new Error('连接已断开，正在重连'))
    if (!started) return
    attempts += 1
    const delay = Math.min(5000, 400 * 2 ** Math.min(attempts, 4))
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      open()
    }, delay)
  }

  ws.onerror = () => {
    // onclose 会负责重连
  }
}

function handleMessage(message: ServerMessage): void {
  const store = useAppStore.getState()
  switch (message.type) {
    case 'snapshot':
      store.setSnapshot(message)
      break
    case 'applied':
      store.applyMessage(message)
      settle(message.requestId, (entry) => entry.resolve(message))
      break
    case 'command.result':
      settle(message.requestId, (entry) => entry.resolve(message))
      break
    case 'command.error':
      settle(message.requestId, (entry) => entry.reject(new Error(message.error.message)))
      store.toast(message.error.message, 'error')
      break
    case 'runtime':
      store.setRuntime(message.nodeId, message.runtime)
      break
    case 'toast':
      store.toast(message.message, message.level)
      break
  }
}

function settle(
  requestId: string | undefined,
  callback: (entry: Pending) => void,
): void {
  if (!requestId) return
  const entry = pending.get(requestId)
  if (!entry) return
  window.clearTimeout(entry.timer)
  pending.delete(requestId)
  callback(entry)
}

function rejectAll(error: Error): void {
  for (const entry of pending.values()) {
    window.clearTimeout(entry.timer)
    entry.reject(error)
  }
  pending.clear()
}

export function sendCommand(command: Command): Promise<Resolved> {
  return new Promise((resolve, reject) => {
    const active = socket
    if (!active || active.readyState !== WebSocket.OPEN) {
      reject(new Error('尚未连接到画布服务'))
      return
    }
    const requestId = crypto.randomUUID()
    const timer = window.setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('命令超时'))
    }, 20_000)
    pending.set(requestId, { resolve, reject, timer })
    const message: ClientMessage = { type: 'command', requestId, command }
    active.send(JSON.stringify(message))
  })
}

export function requestResync(): void {
  if (socket?.readyState === WebSocket.OPEN) {
    const message: ClientMessage = { type: 'resync' }
    socket.send(JSON.stringify(message))
  }
}
