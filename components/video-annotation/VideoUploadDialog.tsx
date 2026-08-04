'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLang } from '@/services/i18n'
import styles from './video-upload-dialog.module.css'

export interface VideoUploadOutcome {
  uploadedNames: string[]
  failedNames: string[]
  saved: boolean
}

interface Props {
  busy: boolean
  progress: Record<string, number>
  activeFileName: string | null
  error: string
  onClose: () => void
  onUpload: (files: File[]) => Promise<VideoUploadOutcome>
}

interface QueueItem {
  id: string
  file: File
  validationError: string | null
}

const VIDEO_EXTENSION = /\.(mp4|mov|avi|mkv|webm)$/i

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)} ${units[index]}`
}

function fileType(file: File): string {
  const extension = file.name.split('.').pop()?.toUpperCase()
  return extension && extension.length <= 5 ? extension : 'VIDEO'
}

function itemId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export function VideoUploadDialog({ busy, progress, activeFileName, error, onClose, onUpload }: Props) {
  const { t } = useLang()
  const [items, setItems] = useState<QueueItem[]>([])
  const [completedNames, setCompletedNames] = useState<Set<string>>(() => new Set())
  const [failedNames, setFailedNames] = useState<Set<string>>(() => new Set())
  const [saveFailed, setSaveFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const replaceIdRef = useRef<string | null>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
      // Never let a pending replacement intent survive a dialog close.
      replaceIdRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose])

  const createItem = useCallback((file: File): QueueItem => ({
    id: itemId(file),
    file,
    validationError: file.type.startsWith('video/') || VIDEO_EXTENSION.test(file.name)
      ? null
      : t('video.upload_invalid_format'),
  }), [t])

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files)
    if (incoming.length === 0) return
    setSaveFailed(false)

    const replacementId = replaceIdRef.current
    replaceIdRef.current = null
    setItems(current => {
      const next = [...current]
      let candidates = incoming
      if (replacementId) {
        const replacement = createItem(incoming[0])
        const replacementIndex = next.findIndex(item => item.id === replacementId)
        if (replacementIndex >= 0) next.splice(replacementIndex, 1, replacement)
        candidates = incoming.slice(1)
      }
      const known = new Set(next.map(item => item.id))
      for (const file of candidates) {
        const item = createItem(file)
        if (!known.has(item.id)) {
          next.push(item)
          known.add(item.id)
        }
      }
      return next
    })
  }, [createItem])

  const removeItem = (id: string) => {
    setItems(current => current.filter(item => item.id !== id))
    setFailedNames(current => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    setCompletedNames(current => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  const replaceItem = (id: string) => {
    replaceIdRef.current = id
    inputRef.current?.click()
  }

  // If the file picker is dismissed, a pending replacement intent must not
  // leak into the next "add more" selection. The `cancel` event is supported
  // by browsers but absent from the React input types, so attach it natively.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const onCancel = () => { replaceIdRef.current = null }
    input.addEventListener('cancel', onCancel)
    return () => input.removeEventListener('cancel', onCancel)
  }, [])

  const validItems = useMemo(() => items.filter(item => !item.validationError), [items])
  const pendingItems = useMemo(
    () => validItems.filter(item => !completedNames.has(item.id)),
    [validItems, completedNames],
  )
  const invalidCount = items.length - validItems.length
  const complete = items.length > 0 && invalidCount === 0 && pendingItems.length === 0 && !saveFailed

  const submit = async () => {
    if (busy || pendingItems.length === 0 || invalidCount > 0) return
    setFailedNames(new Set())
    setSaveFailed(false)
    const outcome = await onUpload(pendingItems.map(item => item.file))
    if (outcome.saved) {
      setCompletedNames(current => new Set([...current, ...outcome.uploadedNames]))
    } else {
      setSaveFailed(outcome.uploadedNames.length > 0)
    }
    setFailedNames(new Set(outcome.failedNames))
  }

  const statusFor = (item: QueueItem): 'error' | 'success' | 'processing' | 'ready' => {
    if (item.validationError || failedNames.has(item.id) || progress[item.id] < 0) return 'error'
    if (completedNames.has(item.id)) return 'success'
    if (busy) return 'processing'
    return 'ready'
  }

  const retryCount = pendingItems.filter(item => failedNames.has(item.id)).length
  const primaryLabel = busy
    ? t('video.upload_uploading')
    : complete
      ? t('video.upload_complete')
      : retryCount > 0
        ? t('video.upload_retry_count', retryCount)
        : t('video.upload_submit_count', pendingItems.length)

  return (
    <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-upload-title"
        aria-describedby="video-upload-description"
        aria-busy={busy}
      >
        <header className={styles.header}>
          <div>
            <h2 id="video-upload-title">{t('video.upload_add_title')}</h2>
            <p id="video-upload-description">{t('video.upload_add_desc')}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={busy}>{t('app.close')}</button>
        </header>

        {items.length === 0 ? (
          <button
            type="button"
            className={styles.dropzone}
            onClick={() => inputRef.current?.click()}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault()
              if (!busy && event.dataTransfer.files.length) addFiles(event.dataTransfer.files)
            }}
            disabled={busy}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M12 16V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <strong>{t('video.upload_drop_title')}</strong>
            <span>{t('video.upload_drop_detail')}</span>
          </button>
        ) : (
          <div className={styles.queue}>
            <div className={styles.queueHeading}>
              <span>{complete ? t('video.upload_completed_files', completedNames.size) : t('video.upload_selected_files', items.length)}</span>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{t('video.upload_add_more')}</button>
            </div>
            <div className={styles.queueRows}>
              {items.map(item => {
                const status = statusFor(item)
                const isActive = busy && activeFileName === item.file.name
                const statusLabel = item.validationError
                  ? t('video.upload_needs_reselect')
                  : status === 'error'
                    ? t('video.upload_needs_retry')
                    : status === 'success'
                      ? t('video.upload_added_to_project')
                      : isActive
                        ? t('video.upload_uploading_file')
                        : busy
                          ? t('video.upload_waiting')
                          : t('video.upload_ready')

                return (
                  <article key={item.id} data-status={status}>
                    <span className={styles.fileType}>{fileType(item.file)}</span>
                    <div className={styles.fileCopy}>
                      <strong title={item.file.name}>{item.file.name}</strong>
                      <small>{formatSize(item.file.size)}{item.validationError ? ` · ${item.validationError}` : ''}</small>
                      {isActive && <i aria-hidden="true"><b /></i>}
                    </div>
                    <span className={styles.fileStatus}>{statusLabel}</span>
                    <button
                      type="button"
                      disabled={busy || status === 'success'}
                      aria-label={`${status === 'error' ? t('video.upload_reselect') : t('app.remove')} ${item.file.name}`}
                      onClick={() => status === 'error' ? replaceItem(item.id) : removeItem(item.id)}
                    >
                      {status === 'error' ? t('video.upload_reselect') : t('app.remove')}
                    </button>
                  </article>
                )
              })}
            </div>
          </div>
        )}

        {(error || saveFailed) && <p className={styles.error} role="alert">{error || t('video.upload_save_failed')}</p>}
        {complete && <p className={styles.success} role="status">{t('video.upload_success_summary', completedNames.size)}</p>}

        <footer className={styles.actions}>
          <button type="button" onClick={onClose} disabled={busy}>{complete ? t('app.close') : t('app.cancel')}</button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || complete || items.length === 0 || pendingItems.length === 0 || invalidCount > 0}
            onClick={() => void submit()}
          >
            {primaryLabel}
          </button>
        </footer>

        <input
          ref={inputRef}
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          multiple
          accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.webm"
          className={styles.fileInput}
          onChange={event => {
            if (event.target.files?.length) addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </section>
    </div>
  )
}
