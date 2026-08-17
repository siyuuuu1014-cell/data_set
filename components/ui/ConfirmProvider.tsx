'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useLang } from '@/services/i18n'
import styles from './confirm-dialog.module.css'

export interface ConfirmOptions {
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

type ConfirmRequest = ConfirmOptions & { resolve: (confirmed: boolean) => void }
type ConfirmAction = (options: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmAction | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useLang()
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const cancelButton = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  const finish = useCallback((confirmed: boolean) => {
    setRequest(current => {
      current?.resolve(confirmed)
      return null
    })
    window.requestAnimationFrame(() => previousFocus.current?.focus())
  }, [])

  const confirmAction = useCallback<ConfirmAction>((options) => {
    const normalized = typeof options === 'string' ? { message: options } : options
    return new Promise<boolean>((resolve) => {
      setRequest(current => {
        current?.resolve(false)
        return { ...normalized, resolve }
      })
    })
  }, [])

  useEffect(() => {
    if (!request) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => cancelButton.current?.focus())
    return () => { document.body.style.overflow = previousOverflow }
  }, [request])

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
      return
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'))
    if (controls.length === 0) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <ConfirmContext.Provider value={confirmAction}>
      {children}
      {request && (
        <div className={styles.backdrop} onMouseDown={() => finish(false)}>
          <div
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={handleDialogKeyDown}
          >
            <div className={styles.copy}>
              <h2 id={titleId}>{request.title || t('app.confirm')}</h2>
              <p id={descriptionId}>{request.message}</p>
            </div>
            <div className={styles.actions}>
              <button ref={cancelButton} type="button" className={styles.cancel} onClick={() => finish(false)}>
                {request.cancelLabel || t('app.cancel')}
              </button>
              <button
                type="button"
                className={styles.confirm}
                onClick={() => finish(true)}
              >
                {request.confirmLabel || t('app.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmAction {
  const confirmAction = useContext(ConfirmContext)
  if (!confirmAction) throw new Error('useConfirm must be used inside ConfirmProvider')
  return confirmAction
}
