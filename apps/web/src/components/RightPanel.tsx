import { Activity, History, SlidersHorizontal } from 'lucide-react'
import { useAppStore, type PanelTab } from '../store'
import { Inspector } from './Inspector'
import { HistoryPanel } from './HistoryPanel'
import { ActivityPanel } from './ActivityPanel'

const TABS: Array<{ id: PanelTab; label: string; icon: typeof SlidersHorizontal }> = [
  { id: 'inspector', label: '属性', icon: SlidersHorizontal },
  { id: 'history', label: '历史', icon: History },
  { id: 'activity', label: '动态', icon: Activity },
]

export function RightPanel() {
  const tab = useAppStore((state) => state.tab)
  const setTab = useAppStore((state) => state.setTab)
  const historyLength = useAppStore((state) => state.history.length)
  const activityLength = useAppStore((state) => state.activity.length)

  return (
    <aside className="right-panel">
      <div className="tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`tab ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            {label}
            {id === 'history' && historyLength > 0 ? (
              <span className="tab-badge">{historyLength}</span>
            ) : null}
            {id === 'activity' && activityLength > 0 ? (
              <span className="tab-badge">{activityLength}</span>
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
