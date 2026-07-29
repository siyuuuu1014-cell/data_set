'use client'

import { useState } from 'react'
import type { CustomJsonExportOptions } from '@/services/video-annotation/export-service'
import type { ExportFormat } from '@/services/video-annotation/types'

interface Props {
  open: boolean
  onClose: () => void
  onExport: (format: ExportFormat, options: CustomJsonExportOptions) => void | Promise<void>
  busy?: boolean
  busyText?: string
  jsonOnly?: boolean
  title?: string
  description?: string
}

const FORMATS: { value: ExportFormat; label: string; desc: string }[] = [
  { value: 'json', label: 'Custom JSON', desc: 'Full annotation plus one video-level sentence summarized from all segments' },
  { value: 'yolo', label: 'YOLO', desc: 'Images + labels (txt) in ZIP, training-ready' },
  { value: 'coco', label: 'COCO JSON', desc: 'Standard detection format, compatible with most frameworks' },
]

export function ExportDialog({
  open,
  onClose,
  onExport,
  busy = false,
  busyText = 'Exporting…',
  jsonOnly = false,
  title = 'Export Annotations',
  description = 'Choose export format for the annotated dataset.',
}: Props) {
  const [selected, setSelected] = useState<ExportFormat>('json')
  const [includeRecognitionText, setIncludeRecognitionText] = useState(false)

  if (!open) return null

  const selectedFormat = jsonOnly ? 'json' : selected
  const formats = jsonOnly ? FORMATS.filter(format => format.value === 'json') : FORMATS
  const closeAndReset = () => {
    setIncludeRecognitionText(false)
    onClose()
  }
  const submit = async () => {
    await onExport(selectedFormat, {
      includeOcr: includeRecognitionText,
      includeSpeechTranscript: includeRecognitionText,
    })
    setIncludeRecognitionText(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={() => { if (!busy) closeAndReset() }}
    >
      <div className="glass-raised rounded-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gv-text mb-1">{title}</h3>
        <p className="text-sm text-gv-text-dim mb-4">{description}</p>

        <div className="space-y-2 mb-6">
          {formats.map(f => (
            <label
              key={f.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedFormat === f.value
                  ? 'border-gv-pink bg-gv-pink/5'
                  : 'border-gv-border hover:border-gv-pink/30'
              }`}
            >
              <input
                type="radio" name="export-format" value={f.value}
                checked={selectedFormat === f.value}
                onChange={() => setSelected(f.value)}
                disabled={busy}
                className="mt-0.5 h-4 w-4 accent-gv-pink"
              />
              <div>
                <p className="text-sm font-medium text-gv-text">{f.label}</p>
                <p className="text-xs text-gv-text-dim mt-0.5">{f.desc}</p>
              </div>
            </label>
          ))}
        </div>

        {selectedFormat === 'json' && (
          <label className="mb-6 flex cursor-pointer items-start gap-3 rounded-lg border border-gv-border p-3 transition-colors hover:border-gv-pink/30">
            <input
              type="checkbox"
              checked={includeRecognitionText}
              onChange={event => setIncludeRecognitionText(event.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 accent-gv-pink"
            />
            <div>
              <p className="text-sm font-medium text-gv-text">Include OCR &amp; Speech</p>
              <p className="mt-0.5 text-xs text-gv-text-dim">
                Adds corrected OCR text objects and the segment speechTranscript. Frames and runtime diagnostics remain excluded.
              </p>
            </div>
          </label>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={closeAndReset} disabled={busy} className="btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? busyText : `Export ${selectedFormat.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  )
}
