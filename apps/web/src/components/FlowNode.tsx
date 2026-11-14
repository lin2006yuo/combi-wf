import type { CSSProperties, MouseEvent } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Image as ImageIcon, Loader2, Play } from 'lucide-react'
import type { NodeRuntime } from '@combi/canvas-core'
import { registry } from '../registry'
import { runNode } from '../commands'
import { NodeIcon } from './NodeIcon'

export type WorkflowNodeData = Record<string, unknown> & {
  label: string
  nodeType: string
  params: Record<string, unknown>
  runtime?: NodeRuntime | null
}

export type WorkflowNode = Node<WorkflowNodeData, string>

const STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '生成失败',
  canceled: '已取消',
}

const PORT_COLOR: Record<string, string> = {
  image: '#8b5cf6',
  video: '#22d3ee',
  audio: '#f59e0b',
  text: '#a3e635',
  any: '#94a3b8',
}

export function FlowNode({ id, data, selected }: NodeProps<WorkflowNode>) {
  const def = registry.get(data.nodeType)
  const params = data.params ?? {}
  const runtime = data.runtime ?? undefined
  const status = runtime?.status
  const busy = status === 'queued' || status === 'running'
  const prompt = typeof params.prompt === 'string' ? params.prompt : ''
  const thumb = runtime?.output?.thumb
  const progress = Math.round(runtime?.progress ?? 0)

  const chips = [
    chip(def.ui.fields, params, 'model'),
    chip(def.ui.fields, params, 'aspectRatio'),
    chip(def.ui.fields, params, 'duration', '秒'),
    chip(def.ui.fields, params, 'transition'),
    chip(def.ui.fields, params, 'resolution'),
  ].filter(Boolean) as string[]

  const run = (event: MouseEvent) => {
    event.stopPropagation()
    void runNode(id)
  }

  return (
    <div
      className={`flow-node ${selected ? 'is-selected' : ''}`}
      style={{ '--node-accent': def.ui.accent } as CSSProperties}
    >
      {def.inputs.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          title={`${port.label} · ${port.type}`}
          style={{
            top: def.inputs.length > 1 ? `${50 + index * 15}%` : '60%',
            background: PORT_COLOR[port.type] ?? PORT_COLOR.any,
            borderColor: PORT_COLOR[port.type] ?? PORT_COLOR.any,
          }}
        />
      ))}
      {def.outputs.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          title={`${port.label} · ${port.type}`}
          style={{
            top: def.outputs.length > 1 ? `${50 + index * 15}%` : '60%',
            background: PORT_COLOR[port.type] ?? PORT_COLOR.any,
            borderColor: PORT_COLOR[port.type] ?? PORT_COLOR.any,
          }}
        />
      ))}

      <div className="node-head">
        <span className="node-icon">
          <NodeIcon name={def.ui.icon} size={16} />
        </span>
        <div className="node-title-wrap">
          <div className="node-label" title={data.label}>
            {data.label}
          </div>
          <div className="node-type">
            {def.title}
            <span className="node-dot">·</span>
            <span className="node-id">{id}</span>
          </div>
        </div>
        <span className={`node-status-dot ${status ?? 'idle'}`} title={STATUS_TEXT[status ?? ''] ?? '未运行'} />
      </div>

      <div className="node-body">
        {prompt ? <p className="node-prompt">{prompt}</p> : null}
        {!prompt && def.category === 'compose' ? (
          <p className="node-prompt muted">
            {chips.join(' · ') || '按连线顺序拼接片段'}
          </p>
        ) : null}
        {chips.length > 0 && prompt ? (
          <div className="node-chips">
            {chips.slice(0, 3).map((value) => (
              <span key={value} className="chip">
                {value}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="node-preview">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" />
        ) : (
          <div className="preview-empty">
            <ImageIcon size={18} />
            <span>{busy ? '生成中…' : '尚未生成'}</span>
          </div>
        )}
        {busy ? (
          <div className="preview-overlay">
            <Loader2 size={16} className="spin" />
            <span>{progress}%</span>
          </div>
        ) : null}
        {runtime?.stale ? <span className="stale-badge">参数已变更</span> : null}
        {status === 'succeeded' && def.category !== 'image' ? (
          <span className="play-badge">
            <Play size={12} fill="currentColor" />
          </span>
        ) : null}
        {busy ? (
          <div className="node-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </div>

      <div className="node-foot">
        <span className={`runtime-pill ${status ?? 'idle'}`}>
          {STATUS_TEXT[status ?? ''] ?? '未运行'}
          {runtime?.stale ? ' · stale' : ''}
        </span>
        <button
          className="node-run nodrag"
          onClick={run}
          disabled={busy}
          title="运行此节点"
        >
          {busy ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
        </button>
      </div>
    </div>
  )
}

function chip(
  fields: Array<{
    key: string
    options?: Array<{ value: string; label: string }>
  }>,
  params: Record<string, unknown>,
  key: string,
  suffix = '',
): string | null {
  const value = params[key]
  if (value === undefined || value === null || value === '') return null
  const field = fields.find((item) => item.key === key)
  const option = field?.options?.find((item) => item.value === String(value))
  return option?.label ?? `${String(value)}${suffix}`
}
