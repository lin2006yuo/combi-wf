import { useState, type CSSProperties } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Bot, Check, Copy, Plus } from 'lucide-react'
import { useAppStore } from '../store'
import { registry } from '../registry'
import { addNode } from '../commands'
import { MCP_URL } from '../api'
import { NodeIcon } from './NodeIcon'

export function Palette() {
  const { screenToFlowPosition } = useReactFlow()
  const doc = useAppStore((state) => state.doc)
  const info = useAppStore((state) => state.info)

  const add = (type: string) => {
    const center = screenToFlowPosition({
      x: window.innerWidth * 0.52,
      y: window.innerHeight * 0.48,
    })
    const offset = (doc?.nodeOrder.length ?? 0) % 5
    void addNode(type, {
      x: Math.round(center.x + offset * 34 - 120),
      y: Math.round(center.y + offset * 26 - 60),
    })
  }

  return (
    <aside className="left-panel">
      <div className="panel-section">
        <div className="section-head">
          <span className="section-title">节点库</span>
          <span className="section-hint">点击添加</span>
        </div>
        <div className="node-list">
          {registry.list().map((def) => (
            <button
              key={def.type}
              className="palette-card"
              style={{ '--node-accent': def.ui.accent } as CSSProperties}
              onClick={() => add(def.type)}
              title={def.description}
            >
              <span className="palette-icon">
                <NodeIcon name={def.ui.icon} size={17} />
              </span>
              <span className="palette-copy">
                <span className="palette-title">{def.title}</span>
                <span className="palette-desc">{def.description}</span>
              </span>
              <span className="palette-plus">
                <Plus size={14} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="section-head">
          <span className="section-title">外部 Agent</span>
          <span className="live-tag">
            <span className="live-dot" />
            MCP
          </span>
        </div>
        <div className="agent-card">
          <div className="agent-head">
            <span className="agent-icon">
              <Bot size={16} />
            </span>
            <div>
              <div className="agent-title">把画布交给 Agent</div>
              <div className="agent-sub">Claude / Cursor / 自研 agent</div>
            </div>
          </div>
          <AgentEndpoint />
          <div className="agent-tools">
            <code>get_canvas</code>
            <code>batch</code>
            <code>run_graph</code>
            <code>undo_my_last</code>
          </div>
          <p className="agent-note">
            每个工具调用都走同一套 Command 校验与历史，与手动操作共用一条撤销栈。
            {info?.tokenRequired ? ' 需要 Bearer token。' : ''}
          </p>
        </div>
      </div>

      <div className="panel-section">
        <div className="policy-card">
          <div className="policy-title">事务策略</div>
          <p>
            拖拽在本地完成，松手只写 <b>1 条</b>历史；Agent 的一次 <code>batch</code> 也只写{' '}
            <b>1 条</b>。生成进度不进入撤销栈。
          </p>
        </div>
      </div>
    </aside>
  )
}

function AgentEndpoint() {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      useAppStore.getState().toast('复制失败，请手动选择地址', 'warn')
    }
  }

  return (
    <div className="endpoint">
      <code title={MCP_URL}>{MCP_URL}</code>
      <button className="copy-btn" onClick={() => void copy()} title="复制 MCP 地址">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}
