import { CanvasError } from '../errors'
import type { NodeDefinition } from './types'

export class NodeRegistry {
  private readonly defs = new Map<string, NodeDefinition>()

  register(def: NodeDefinition): this {
    if (this.defs.has(def.type)) {
      throw new Error(`duplicate node definition: ${def.type}`)
    }
    this.defs.set(def.type, def)
    return this
  }

  has(type: string): boolean {
    return this.defs.has(type)
  }

  get(type: string): NodeDefinition {
    const def = this.defs.get(type)
    if (!def) {
      throw new CanvasError('NODE_TYPE_UNKNOWN', `未知节点类型：${type}`)
    }
    return def
  }

  list(): NodeDefinition[] {
    return [...this.defs.values()]
  }

  types(): string[] {
    return [...this.defs.keys()]
  }
}
