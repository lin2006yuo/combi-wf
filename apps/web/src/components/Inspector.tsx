import { AlertTriangle, ExternalLink, Loader2, Play, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { FieldDef, NodeRuntime } from '@combi/canvas-core'
import { registry } from '../registry'
import { deleteNodes, runNode, updateNode } from '../commands'
import { useInspectorModel } from '../graph/hooks'
import { NodeIcon } from './NodeIcon'

const STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '生成失败',
  canceled: '已取消',
}

export function Inspector() {
  const { selectedIds, node, runtime } = useInspectorModel()

  if (!node) {
    return (
      <div className="empty-inspector">
        <span className="empty-icon">
          <SlidersHorizontal size={18} />
        </span>
        <div className="empty-title">未选中节点</div>
        <p>点击画布上的节点查看参数。修改会在失焦时提交为一条命令。</p>
        <div className="empty-keys">
          <span>
            <kbd>⌘Z</kbd> 撤销
          </span>
          <span>
            <kbd>Del</kbd> 删除
          </span>
          <span>
            <kbd>Shift</kbd> 多选
          </span>
        </div>
      </div>
    )
  }

  const def = registry.get(node.type)
  const busy = runtime?.status === 'queued' || runtime?.status === 'running'

  const commit = (key: string, value: unknown) => {
    void updateNode(node.id, { [key]: value })
  }

  return (
    <div className="inspector">
      <div className="inspector-head">
        <span className="inspector-icon" style={{ color: def.ui.accent }}>
          <NodeIcon name={def.ui.icon} size={18} />
        </span>
        <div className="inspector-title-wrap">
          <div className="inspector-title">{node.data.label ?? def.title}</div>
          <div className="inspector-sub">
            {def.title} · <code>{node.id}</code>
          </div>
        </div>
        <span className={`runtime-pill ${runtime?.status ?? 'idle'}`}>
          {STATUS_TEXT[runtime?.status ?? ''] ?? '未运行'}
        </span>
      </div>

      {selectedIds.length > 1 ? (
        <div className="multi-note">已选择 {selectedIds.length} 个节点，当前显示第一个</div>
      ) : null}

      <div className="inspector-section">
        <div className="field-label">节点名称</div>
        <input
          key={`label-${node.id}-${node.data.label}`}
          className="text-input"
          defaultValue={node.data.label ?? ''}
          onBlur={(event) => {
            const next = event.target.value.trim()
            if (next && next !== node.data.label) void updateNode(node.id, undefined, next)
          }}
        />
      </div>

      <div className="inspector-section">
        <div className="section-line">
          <span className="field-label">参数</span>
          <span className="section-note">失焦即提交</span>
        </div>
        <div className="field-grid">
          {def.ui.fields.map((field) => (
            <ParamField
              key={`${node.id}-${field.key}-${JSON.stringify(node.data.params[field.key])}`}
              field={field}
              value={node.data.params[field.key]}
              onCommit={(value) => commit(field.key, value)}
            />
          ))}
        </div>
      </div>

      <div className="inspector-section">
        <div className="section-line">
          <span className="field-label">运行状态</span>
          {runtime?.stale ? (
            <span className="stale-inline">
              <AlertTriangle size={12} /> 参数已变更
            </span>
          ) : null}
        </div>
        <RuntimeCard runtime={runtime} busy={busy} />
      </div>

      <div className="inspector-section">
        <div className="section-line">
          <span className="field-label">端口</span>
          <span className="section-note">执行面不进入历史</span>
        </div>
        <div className="meta-grid">
          <div>
            <span>输入</span>
            <b>
              {def.inputs.length === 0
                ? '—'
                : def.inputs.map((port) => `${port.label}(${port.type})`).join(' / ')}
            </b>
          </div>
          <div>
            <span>输出</span>
            <b>{def.outputs.map((port) => `${port.label}(${port.type})`).join(' / ') || '—'}</b>
          </div>
        </div>
      </div>

      <div className="inspector-actions">
        <button className="btn" onClick={() => void runNode(node.id)} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {busy ? '生成中' : '运行本节点'}
        </button>
        <button className="btn danger-ghost" onClick={() => void deleteNodes([node.id])}>
          <Trash2 size={14} />
          删除
        </button>
      </div>
    </div>
  )
}

function ParamField({
  field,
  value,
  onCommit,
}: {
  field: FieldDef
  value: unknown
  onCommit: (value: unknown) => void
}) {
  if (field.kind === 'switch') {
    const enabled = Boolean(value)
    return (
      <div className="field-row switch-row">
        <div className="field-meta">
          <span className="field-name">{field.label}</span>
          {field.help ? <span className="field-help">{field.help}</span> : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={`switch ${enabled ? 'on' : ''}`}
          onClick={() => onCommit(!enabled)}
        >
          <span className="knob" />
        </button>
      </div>
    )
  }

  if (field.kind === 'select') {
    return (
      <label className="field-row">
        <span className="field-name">{field.label}</span>
        <select
          className="select-input"
          value={String(value ?? '')}
          onChange={(event) => {
            const raw = event.target.value
            onCommit(typeof value === 'number' ? Number(raw) : raw)
          }}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.help ? <span className="field-help">{field.help}</span> : null}
      </label>
    )
  }

  if (field.kind === 'textarea') {
    return (
      <label className="field-row">
        <span className="field-name">{field.label}</span>
        <textarea
          className="textarea-input"
          rows={4}
          defaultValue={String(value ?? '')}
          placeholder={field.placeholder}
          onBlur={(event) => {
            const next = event.target.value
            if (next !== String(value ?? '')) onCommit(next)
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              ;(event.target as HTMLTextAreaElement).blur()
            }
          }}
        />
        <span className="field-help">⌘Enter 提交</span>
      </label>
    )
  }

  if (field.kind === 'number') {
    return (
      <label className="field-row">
        <span className="field-name">{field.label}</span>
        <input
          className="text-input"
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          defaultValue={value === undefined || value === null ? '' : String(value)}
          onBlur={(event) => {
            const raw = event.target.value
            if (raw === '') return
            const next = Number(raw)
            if (Number.isFinite(next) && next !== value) onCommit(next)
          }}
        />
        {field.help ? <span className="field-help">{field.help}</span> : null}
      </label>
    )
  }

  return (
    <label className="field-row">
      <span className="field-name">{field.label}</span>
      <input
        className="text-input"
        defaultValue={String(value ?? '')}
        placeholder={field.placeholder}
        onBlur={(event) => {
          const next = event.target.value
          if (next !== String(value ?? '')) onCommit(next)
        }}
      />
    </label>
  )
}

function RuntimeCard({ runtime, busy }: { runtime?: NodeRuntime; busy: boolean }) {
  if (!runtime) {
    return (
      <div className="runtime-card muted-card">
        <div className="runtime-empty">还没有运行记录。点击「运行本节点」开始生成。</div>
      </div>
    )
  }

  return (
    <div className="runtime-card">
      <div className="runtime-row">
        <span className={`runtime-pill ${runtime.status}`}>{STATUS_TEXT[runtime.status]}</span>
        {runtime.jobId ? <code className="job-id">{runtime.jobId}</code> : null}
        <span className="runtime-progress-text">{Math.round(runtime.progress)}%</span>
      </div>
      {busy ? (
        <div className="runtime-bar">
          <span style={{ width: `${Math.round(runtime.progress)}%` }} />
        </div>
      ) : null}
      {runtime.error ? <div className="runtime-error">{runtime.error}</div> : null}
      {runtime.output ? (
        <div className="runtime-output">
          {runtime.output.thumb ? (
            <img src={runtime.output.thumb} alt="" loading="lazy" />
          ) : null}
          <a href={runtime.output.url} target="_blank" rel="noreferrer" className="output-link">
            打开输出 <ExternalLink size={12} />
          </a>
        </div>
      ) : null}
    </div>
  )
}
