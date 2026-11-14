import type { ServerMessage } from '@combi/canvas-core'
import type { WebSocket } from 'ws'

/** 单机房间广播。多实例时替换成 Redis pub/sub 即可。 */
export class Hub {
  private readonly rooms = new Map<string, Set<WebSocket>>()

  add(docId: string, socket: WebSocket): void {
    let room = this.rooms.get(docId)
    if (!room) {
      room = new Set()
      this.rooms.set(docId, room)
    }
    room.add(socket)
  }

  remove(docId: string, socket: WebSocket): void {
    const room = this.rooms.get(docId)
    if (!room) return
    room.delete(socket)
    if (room.size === 0) this.rooms.delete(docId)
  }

  send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== 1) return
    socket.send(JSON.stringify(message))
  }

  broadcast(docId: string, message: ServerMessage): void {
    const room = this.rooms.get(docId)
    if (!room) return
    const payload = JSON.stringify(message)
    for (const socket of room) {
      if (socket.readyState === 1) socket.send(payload)
    }
  }

  count(docId: string): number {
    return this.rooms.get(docId)?.size ?? 0
  }
}
