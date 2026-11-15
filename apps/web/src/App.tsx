import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { SERVER_URL, fetchInfo } from './api'
import { startConnection } from './ws'
import { graph } from './graph/state'
import { useAppModel } from './graph/hooks'
import { Toolbar } from './components/Toolbar'
import { Palette } from './components/Palette'
import { Canvas } from './components/Canvas'
import { RightPanel } from './components/RightPanel'
import { Toasts } from './components/Toasts'

export function App() {
  const { loaded, status } = useAppModel()

  useEffect(() => {
    startConnection()
    fetchInfo()
      .then((info) => graph.setInfo(info))
      .catch(() => undefined)
  }, [])

  if (!loaded) {
    return (
      <div className="boot">
        <div className="boot-mark">C</div>
        <div className="boot-title">Combi Flow</div>
        <div className="boot-sub">AI 短视频工作流</div>
        <div className="boot-status">
          <span className={`status-dot ${status}`} />
          {status === 'connecting' ? '正在连接画布服务…' : '等待服务响应…'}
        </div>
        <div className="boot-hint">{SERVER_URL}</div>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        <div className="workspace">
          <Palette />
          <Canvas />
          <RightPanel />
        </div>
        <Toasts />
      </div>
    </ReactFlowProvider>
  )
}
