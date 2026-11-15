import { Loader2, Play, Redo2, Sparkles, Undo2 } from 'lucide-react'
import { useToolbarModel } from '../graph/hooks'
import { redo, runGraph, undo } from '../commands'

export function Toolbar() {
  const { rev, nodeCount, history, status, anyRunning, canUndo, canRedo } = useToolbarModel()
  const applied = history.filter((entry) => entry.status === 'applied').length
  const undone = history.filter((entry) => entry.status === 'undone').length
  const statusText = status === 'open' ? '已连接' : status === 'connecting' ? '连接中' : '已断开'

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <Sparkles size={17} />
        </div>
        <div className="brand-text">
          <div className="brand-title">
            AI 短视频工作流<span className="brand-beta">BETA</span>
          </div>
          <div className="brand-sub">Combi Flow · signals runtime</div>
        </div>
      </div>

      <div className="topbar-center">
        <div className={`connection-pill ${status}`} title={`服务状态：${statusText}`}>
          <span className={`status-dot ${status}`} />
          {statusText}
        </div>
        <div className="rev-chip" title="服务端文档版本">
          rev {rev}
        </div>
        <div className="rev-chip" title="已应用 / 可重做">
          {applied} / {undone}
        </div>
      </div>

      <div className="topbar-actions">
        <button
          className="icon-btn"
          onClick={() => void undo()}
          disabled={!canUndo}
          title="撤销 (⌘Z)"
          aria-label="撤销"
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon-btn"
          onClick={() => void redo()}
          disabled={!canRedo}
          title="重做 (⇧⌘Z)"
          aria-label="重做"
        >
          <Redo2 size={17} />
        </button>
        <div className="toolbar-divider" />
        <button
          className="btn primary"
          onClick={() => void runGraph()}
          disabled={anyRunning || nodeCount === 0}
        >
          {anyRunning ? <Loader2 size={15} className="spin" /> : <Play size={15} fill="currentColor" />}
          {anyRunning ? '运行中' : '运行工作流'}
        </button>
      </div>
    </header>
  )
}
