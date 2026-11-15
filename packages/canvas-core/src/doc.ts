import type { CanvasDoc } from './types'

export function createEmptyDoc(id: string): CanvasDoc {
  return {
    id,
    rev: 0,
    nodes: {},
    edges: {},
    nodeOrder: [],
    edgeOrder: [],
  }
}
