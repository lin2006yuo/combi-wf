import { Activity, Cpu, Redo2, Undo2 } from 'lucide-react'
import { useActivityModel } from '../graph/hooks'

const SOURCE_LABEL: Record<string, string> = {
  user: '你',
  agent: 'Agent',
  system: '系统',
  undo: '撤销',
}

export function ActivityPanel() {
  const { activity } = useActivityModel()

  if (activity.length === 0) {
    return (
      <div className="empty-panel">
        <span className="empty-icon">
          <Activity size={18} />
        </span>
        <div className="empty-title">暂无动态</div>
        <p>命令、撤销、生成状态都会汇总在这里，包括外部 agent 的操作。</p>
      </div>
    )
  }

  return (
    <div className="activity-list">
      {activity.map((item) => (
        <div key={item.id} className={`activity-item ${item.source}`}>
          <span className={`activity-icon ${item.source}`}>
            {item.kind === 'undo' ? (
              <Undo2 size={13} />
            ) : item.kind === 'redo' ? (
              <Redo2 size={13} />
            ) : item.kind === 'runtime' ? (
              <Cpu size={13} />
            ) : (
              <Activity size={13} />
            )}
          </span>
          <div className="activity-content">
            <div className="activity-label">{item.label}</div>
            <div className="activity-meta">
              <span className={`source-tag ${item.source}`}>
                {SOURCE_LABEL[item.source] ?? item.source}
              </span>
              {item.actorId ? <span className="actor">{item.actorId}</span> : null}
              <span>{timeAgo(item.ts)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  if (diff < 5_000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
}
