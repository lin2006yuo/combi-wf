import { History, Redo2, Undo2 } from 'lucide-react'
import { useAppStore } from '../store'

const SOURCE_META: Record<string, { label: string; className: string }> = {
  user: { label: '你', className: 'user' },
  agent: { label: 'Agent', className: 'agent' },
  system: { label: '系统', className: 'system' },
  undo: { label: '撤销', className: 'undo' },
}

export function HistoryPanel() {
  const entries = useAppStore((state) => state.history)
  const cursor = useAppStore((state) => state.cursor)

  if (entries.length === 0) {
    return (
      <div className="empty-panel">
        <span className="empty-icon">
          <History size={18} />
        </span>
        <div className="empty-title">还没有历史</div>
        <p>拖动节点、改参数、删节点，都会在这里留下一条可撤销的记录。</p>
      </div>
    )
  }

  return (
    <div className="history-panel">
      <div className="history-summary">
        <span>
          <Undo2 size={12} /> {cursor} 条已应用
        </span>
        <span>
          <Redo2 size={12} /> {entries.length - cursor} 条可重做
        </span>
      </div>

      <div className="history-list">
        {[...entries].reverse().map((entry, reverseIndex) => {
          const index = entries.length - 1 - reverseIndex
          const meta = SOURCE_META[entry.source] ?? SOURCE_META.system
          const undone = index >= cursor
          const current = index === cursor - 1
          return (
            <div
              key={entry.id}
              className={`history-item ${undone ? 'is-undone' : ''} ${current ? 'is-current' : ''}`}
            >
              <div className="history-rail">
                <span className={`history-dot ${meta.className}`} />
              </div>
              <div className="history-content">
                <div className="history-line">
                  <span className={`source-tag ${meta.className}`}>{meta.label}</span>
                  <span className="history-label">{entry.label}</span>
                </div>
                <div className="history-meta">
                  <span>#{entry.seq}</span>
                  <span>{formatTime(entry.ts)}</span>
                  {entry.actorId ? <span className="actor">{entry.actorId}</span> : null}
                  {current ? <span className="current-tag">当前</span> : null}
                  {undone ? <span className="undone-tag">已撤销</span> : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="panel-footnote">
        历史只记录文档意图（结构 + 参数）。生成进度、输出、stale 属于执行面，不进入撤销栈。
      </div>
    </div>
  )
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
