'use client'

import { useState, useEffect } from 'react'
import type { SegmentAnnotation } from '@/services/video-annotation/types'

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _pipeline_errors, _recognition, ...topClean } = annotation as unknown as Record<string, unknown>
    const cleaned = {
      ...topClean,
      persons: (annotation.persons || []).map(({ ...p }) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _className, _detectionConfidence, ...rest } = p as unknown as Record<string, unknown>
        return rest as unknown as typeof p
      }),
      objects: (annotation.objects || []).filter(o => !o._textContent).map(({ ...o }) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _detectionConfidence, _textContent, ...rest } = o as unknown as Record<string, unknown>
        return rest as unknown as typeof o
      }),
      events: (annotation.events || []).filter(event => !event.type.startsWith('[Speech]')),
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
        Edit JSON
      </button>
    )
  }

  return (
    <div className="mt-3">
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
