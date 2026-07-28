'use client'

import { useState, useEffect, useCallback } from 'react'

export interface UndoToastItem {
  id: number
  itemKey: string
  message: string
}

interface Props {
  toasts: UndoToastItem[]
  onUndo: (itemKey: string) => void
  onDismiss: (id: number) => void
}

const TOAST_DURATION = 6000
const ANIMATION_DURATION = 300

function ToastEntry({ toast, onUndo, onDismiss }: {
  toast: UndoToastItem
  onUndo: (itemKey: string) => void
  onDismiss: (id: number) => void
}) {
  const [exiting, setExiting] = useState(false)

  const dismiss = useCallback(() => {
    setExiting(true)
    setTimeout(() => onDismiss(toast.id), ANIMATION_DURATION)
  }, [toast.id, onDismiss])

  useEffect(() => {
    const timer = setTimeout(dismiss, TOAST_DURATION)
    return () => clearTimeout(timer)
  }, [dismiss])

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-lg
        bg-gv-surface border border-gv-border
        transition-all duration-300 ease-out
        ${exiting ? 'opacity-0 translate-y-2 scale-95' : 'opacity-100 translate-y-0 scale-100'}
      `}
    >
      <span className="text-sm text-gv-text">{toast.message}</span>
      <button
        onClick={() => onUndo(toast.itemKey)}
        className="text-sm font-medium text-gv-pink hover:text-gv-pink-dark transition-colors px-2 py-0.5 rounded hover:bg-gv-pink/5"
      >
        撤销
      </button>
    </div>
  )
}

export function UndoToast({ toasts, onUndo, onDismiss }: Props) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col-reverse items-center gap-2">
      {toasts.map(toast => (
        <ToastEntry key={toast.id} toast={toast} onUndo={onUndo} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
