'use client'

import { useState, useEffect } from 'react'
import type { SegmentAnnotation } from '@/services/video-annotation/types'
import { visualEventsFor } from '@/services/video-annotation/visual-events'

interface Props {
  annotation: SegmentAnnotation | null
  onSave: (updated: SegmentAnnotation) => void
}

export function JsonEditor({ annotation, onSave }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset editable text from source
    if (!annotation) { setText(''); return }
    // Clean internal fields before showing
    const topClean = { ...annotation } as unknown as Record<string, unknown>
    delete topClean._pipeline_errors
    delete topClean._recognition
    delete topClean._provider_statuses
    delete topClean._pipeline_status
    delete topClean._identity_aliases
    delete topClean._humanEdited
    const legacySpeech = (annotation.events || [])
      .filter(event => event.type.startsWith('[Speech]'))
      .map(event => event.type.replace(/^\[Speech\]\s*/, '').trim())
      .filter(Boolean)
      .join('\n')
    const cleaned = {
      ...topClean,
      speechTranscript: annotation.speechTranscript || legacySpeech || undefined,
      persons: (annotation.persons || []).map(({ ...p }) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _className, _detectionConfidence, ...rest } = p as unknown as Record<string, unknown>
        return rest as unknown as typeof p
      }),
      objects: (annotation.objects || []).map(({ ...o }) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _detectionConfidence, ...rest } = o as unknown as Record<string, unknown>
        return rest as unknown as typeof o
      }),
      // Speech is stored separately from visual events. Migrate old
      // "[Speech] ..." entries when opening annotations created by older builds.
      events: visualEventsFor(annotation),
    }
    setText(JSON.stringify(cleaned, null, 2))
    setError('')
  }, [annotation])

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-xs text-gv-text-muted hover:text-gv-pink underline mt-2"
      >
        Edit Segment JSON (Internal)
      </button>
    )
  }

  return (
    <div className="mt-3">
      <p className="mb-2 text-xs text-gv-text-muted">
        Segment-level internal data may include all sampled frames, OCR, and speech.
        Use Export Current Frame JSON for a frame-only file.
      </p>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setError('') }}
        className="w-full h-64 text-xs font-mono bg-gv-bg-deep border border-gv-border rounded-lg p-3 focus:border-gv-pink focus:outline-none resize-y"
        spellCheck={false}
      />
      {error && <p className="text-xs text-gv-pink mt-1">{error}</p>}
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => {
            try {
              const parsed = JSON.parse(text) as SegmentAnnotation
              onSave(parsed)
              setError('')
            } catch (e) {
              setError(`Invalid JSON: ${String(e)}`)
            }
          }}
          className="rounded px-3 py-1 text-xs font-medium bg-gv-green/20 text-gv-green-deep hover:bg-gv-green/30"
        >
          Apply JSON
        </button>
        <button
          onClick={() => setExpanded(false)}
          className="rounded px-3 py-1 text-xs text-gv-text-dim hover:bg-gv-bg-deep"
        >
          Close
        </button>
      </div>
    </div>
  )
}
