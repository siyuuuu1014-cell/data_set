'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLang } from '@/services/i18n'
import type { CustomJsonExportOptions } from '@/services/video-annotation/export-service'
import type { ExportFormat } from '@/services/video-annotation/types'
import styles from './review-export.module.css'

interface Props {
  open: boolean
  onClose: () => void
  onExport: (format: ExportFormat, options: CustomJsonExportOptions) => boolean | void | Promise<boolean | void>
  busy?: boolean
  busyText?: string
  jsonOnly?: boolean
  title?: string
  description?: string
  outputNames?: Partial<Record<ExportFormat, string>>
}

const FORMAT_VALUES: ExportFormat[] = ['json', 'yolo', 'coco']

export function ExportDialog({
  open,
  onClose,
  onExport,
  busy = false,
  busyText,
  jsonOnly = false,
  title,
  description,
  outputNames,
}: Props) {
  const { t } = useLang()
  const [selected, setSelected] = useState<ExportFormat>('json')
  const [hovered, setHovered] = useState<ExportFormat | null>(null)
  const [includeRecognitionText, setIncludeRecognitionText] = useState(false)
  const [feedback, setFeedback] = useState<'idle' | 'error' | 'success'>('idle')
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(busy)

  const formats = useMemo(() => jsonOnly ? FORMAT_VALUES.slice(0, 1) : FORMAT_VALUES, [jsonOnly])
  const selectedFormat = jsonOnly ? 'json' : selected
  const visualFormat = hovered ?? selectedFormat
  const visualIndex = Math.max(0, formats.indexOf(visualFormat))
  const sliderStyle = {
    '--slide-count': formats.length,
    '--slide-index': visualIndex,
  } as CSSProperties
  const outputName = outputNames?.[selectedFormat] ?? t(`video.export_detail.${selectedFormat}.output`)

  const closeAndReset = useCallback(() => {
    if (busyRef.current) return
    setIncludeRecognitionText(false)
    setFeedback('idle')
    setHovered(null)
    onClose()
  }, [onClose])

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        closeAndReset()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open, closeAndReset])

  if (!open) return null

  const submit = async () => {
    if (busy || feedback === 'success') return
    setFeedback('idle')
    try {
      const result = await onExport(selectedFormat, {
        includeOcr: includeRecognitionText,
        includeSpeechTranscript: includeRecognitionText,
      })
      setFeedback(result === false ? 'error' : 'success')
    } catch {
      setFeedback('error')
    }
  }

  return (
    <div
      className={styles.overlay}
      onMouseDown={event => {
        if (event.target === event.currentTarget) closeAndReset()
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
      >
        <header className={styles.dialogHeader}>
          <div>
            <h2 id={titleId}>{title ?? t('video.export_dialog_title')}</h2>
            <p id={descriptionId}>{description ?? t('video.export_dialog_desc')}</p>
          </div>
          <button ref={closeRef} type="button" onClick={closeAndReset} disabled={busy}>{t('app.close')}</button>
        </header>

        <fieldset className={styles.formatGroup} disabled={busy}>
          <legend>{t('video.export_format')}</legend>
          <div
            className={styles.formatSlider}
            style={sliderStyle}
            role="group"
            aria-label={t('video.export_format')}
            onMouseLeave={() => setHovered(null)}
          >
            <span className={styles.formatIndicator} aria-hidden="true" />
            {formats.map(format => (
              <button
                type="button"
                key={format}
                aria-pressed={selectedFormat === format}
                data-visual={visualFormat === format}
                onMouseEnter={() => setHovered(format)}
                onClick={() => {
                  setSelected(format)
                  setHovered(null)
                  setFeedback('idle')
                }}
              >
                {t(`video.export_format.${format}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <section className={styles.exportSummary} aria-live="polite">
          <div>
            <span>{t('video.export_output_file')}</span>
            <strong>{outputName}</strong>
          </div>
          <div>
            <span>{t('video.export_includes')}</span>
            <strong>{t(`video.export_detail.${selectedFormat}.includes`)}</strong>
          </div>
          <p>{t(`video.export_detail.${selectedFormat}.description`)}</p>
        </section>

        {selectedFormat === 'json' && (
          <label className={styles.recognitionOption}>
            <input
              type="checkbox"
              checked={includeRecognitionText}
              onChange={event => {
                setIncludeRecognitionText(event.target.checked)
                setFeedback('idle')
              }}
              disabled={busy || feedback === 'success'}
            />
            <span>
              <strong>{t('video.export_include_recognition')}</strong>
              <small>{t('video.export_include_recognition_desc')}</small>
            </span>
          </label>
        )}

        {feedback === 'error' && <p className={styles.exportError} role="alert">{t('video.export_inline_error')}</p>}
        {feedback === 'success' && <p className={styles.exportSuccess} role="status">{t('video.export_inline_success', outputName)}</p>}
        {busy && (
          <p className={styles.exportProgress} role="status">
            <i aria-hidden="true" />
            <span>{busyText ?? t('video.export_processing')}</span>
          </p>
        )}

        <footer className={styles.dialogActions}>
          <button type="button" onClick={closeAndReset} disabled={busy} className={styles.cancelButton}>
            {feedback === 'success' ? t('app.close') : t('app.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || feedback === 'success'}
            className={styles.exportButton}
          >
            {busy ? (busyText ?? t('video.export_processing')) : t('video.export_submit', t(`video.export_format.${selectedFormat}`))}
          </button>
        </footer>
      </section>
    </div>
  )
}
