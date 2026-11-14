import type { z } from 'zod'
import type { MediaType } from '../types'

export interface PortDef {
  id: string
  label: string
  type: MediaType
  required?: boolean
  /** true 表示该输入端口可以接多条边（如组合节点的 clips） */
  multi?: boolean
  description?: string
}

export type FieldKind = 'text' | 'textarea' | 'select' | 'number' | 'switch'

export interface FieldOption {
  value: string
  label: string
}

/** UI 描述。zod 负责校验，fields 负责渲染属性面板，两者都从 registry 单一来源派生。 */
export interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  options?: FieldOption[]
  min?: number
  max?: number
  step?: number
  placeholder?: string
  help?: string
}

export type NodeCategory = 'image' | 'video' | 'compose' | 'utility'

export type NodeIcon = 'image' | 'video' | 'layers' | 'sparkles'

export interface NodeDefinition<P extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string
  title: string
  category: NodeCategory
  /** 给人和 agent 看的说明，会出现在 MCP list_node_types 里 */
  description: string
  inputs: PortDef[]
  outputs: PortDef[]
  params: P
  defaults: z.infer<P>
  ui: {
    fields: FieldDef[]
    accent: string
    icon: NodeIcon
  }
}
