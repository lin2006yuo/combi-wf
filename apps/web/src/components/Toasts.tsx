import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useAppStore } from '../store'

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.level}`}>
          <span className="toast-icon">
            {toast.level === 'error' ? (
              <AlertTriangle size={15} />
            ) : toast.level === 'warn' ? (
              <AlertTriangle size={15} />
            ) : toast.message.startsWith('已') || toast.message.includes('完成') ? (
              <CheckCircle2 size={15} />
            ) : (
              <Info size={15} />
            )}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label="关闭">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
