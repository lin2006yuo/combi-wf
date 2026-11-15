import { Activity, History, SlidersHorizontal } from 'lucide-react'
import type { PanelTab } from '../graph/state'
import { graph } from '../graph/state'
import { useRightPanelModel } from '../graph/hooks'
import { Inspector } from './Inspector'
import { HistoryPanel } from './HistoryPanel'
import { ActivityPanel } from './ActivityPanel'

const TABS: Array<{ id: PanelTab; label: string; icon: typeof SlidersHorizontal }> = [
  { id: 'inspector', label: '属性', icon: SlidersHorizontal },
  { id: 'history', label: '历史', icon: History },
  { id: 'activity', label: '动态', icon: Activity },
]

export function RightPanel() {
  const { tab, historyCount, activityCount } = useRightPanelModel()

  return (
    <aside className="right-panel">
      <div className="tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`tab ${tab === id ? 'is-active' : ''}`}
            onClick={() => graph.setTab(id)}
          >
            <Icon size={14} />
            {label}
            {id === 'history' && historyCount > 0 ? (
              <span className="tab-badge">{historyCount}</span>
            ) : null}
            {id === 'activity' && activityCount > 0 ? (
              <span className="tab-badge">{activityCount}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'inspector' ? <Inspector /> : null}
        {tab === 'history' ? <HistoryPanel /> : null}
        {tab === 'activity' ? <ActivityPanel /> : null}
      </div>
    </aside>
  )
}
