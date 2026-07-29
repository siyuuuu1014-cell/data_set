'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SegmentAnnotation } from '@/services/video-annotation/types'
import {
  prepareSegmentAnnotationForReview,
  validateSegmentAnnotationReview,
  withAuthoritativeSegmentMetadata,
} from '@/services/video-annotation/json-review'
import type { SegmentReviewMetadata } from '@/services/video-annotation/json-review'

interface Props {
  annotation: SegmentAnnotation | null
  segmentMetadata: SegmentReviewMetadata
  onSave: (updated: SegmentAnnotation) => void
}

interface ReviewGroupData {
  key: string
  label: string
  description: string
  value: unknown
  count?: number
  defaultOpen?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function printableValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value || '(empty string)'
  return String(value)
}

function containsQuery(label: string, value: unknown, query: string): boolean {
  if (!query) return true
  if (label.toLowerCase().includes(query)) return true
  if (Array.isArray(value)) return value.some((item, index) => containsQuery(`[${index}]`, item, query))
  if (isRecord(value)) return Object.entries(value).some(([key, item]) => containsQuery(key, item, query))
  return printableValue(value).toLowerCase().includes(query)
}

function valueTone(value: unknown): string {
  if (value === null) return 'text-gv-text-muted italic'
  if (typeof value === 'number') return 'text-amber-700'
  if (typeof value === 'boolean') return 'text-sky-700'
  return 'text-gv-text'
}

function JsonTreeNode({
  label,
  value,
  path,
  query,
  depth = 0,
}: {
  label: string
  value: unknown
  path: string
  query: string
  depth?: number
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  if (!containsQuery(label, value, query)) return null

  const collection = Array.isArray(value) || isRecord(value)
  if (!collection) {
    return (
      <div className="grid grid-cols-[minmax(8rem,0.7fr)_minmax(0,1.3fr)] gap-3 border-b border-gv-border/40 py-1.5 last:border-b-0">
        <span className="break-all font-mono text-[11px] text-gv-text-muted" title={path}>{label}</span>
        <span className={`break-words text-xs ${valueTone(value)}`}>{printableValue(value)}</span>
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [`[${index}]`, item] as const)
    : Object.entries(value)
  const open = query.length > 0 || expanded

  return (
    <div className={depth > 0 ? 'border-l border-gv-border/60 pl-3' : ''}>
      <button
        type="button"
        onClick={() => setExpanded(current => !current)}
        className="flex w-full items-center gap-2 py-1.5 text-left text-xs hover:text-gv-pink"
        title={path}
      >
        <span className="w-3 text-gv-text-muted">{open ? '▾' : '▸'}</span>
        <span className="break-all font-mono font-medium text-gv-text">{label}</span>
        <span className="rounded bg-gv-bg-deep px-1.5 py-0.5 text-[10px] text-gv-text-muted">
          {Array.isArray(value) ? `${entries.length} items` : `${entries.length} fields`}
        </span>
      </button>
      {open && (
        <div className="ml-1">
          {entries.length > 0 ? entries.map(([key, item]) => (
            <JsonTreeNode
              key={`${path}.${key}`}
              label={key}
              value={item}
              path={Array.isArray(value) ? `${path}${key}` : `${path}.${key}`}
              query={query}
              depth={depth + 1}
            />
          )) : (
            <p className="py-1.5 pl-5 text-xs italic text-gv-text-muted">Empty</p>
          )}
        </div>
      )}
    </div>
  )
}

function ReviewGroup({ group, query }: { group: ReviewGroupData; query: string }) {
  const [expanded, setExpanded] = useState(Boolean(group.defaultOpen))
  if (!containsQuery(group.label, group.value, query)) return null
  const open = query.length > 0 || expanded
  const entries = isRecord(group.value)
    ? Object.entries(group.value)
    : [[group.key, group.value] as const]

  return (
    <section className="overflow-hidden rounded-lg border border-gv-border bg-white/35">
      <button
        type="button"
        onClick={() => setExpanded(current => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gv-pink/5"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gv-text-muted">{open ? '▾' : '▸'}</span>
            <h4 className="text-sm font-semibold text-gv-text">{group.label}</h4>
            {group.count !== undefined && (
              <span className="rounded-full bg-gv-pink/10 px-2 py-0.5 text-[10px] text-gv-pink">{group.count}</span>
            )}
          </div>
          <p className="mt-0.5 pl-5 text-[11px] text-gv-text-muted">{group.description}</p>
        </div>
      </button>
      {open && (
        <div className="border-t border-gv-border px-4 py-2">
          {entries.map(([key, value]) => (
            <JsonTreeNode
              key={`${group.key}.${key}`}
              label={key}
              value={value}
              path={`${group.key}.${key}`}
              query={query}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function JsonEditor({ annotation, segmentMetadata, onSave }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'review' | 'raw'>('review')
  const [query, setQuery] = useState('')

  const { segmentId, start, end } = segmentMetadata
  const sourceText = useMemo(() => (
    annotation
      ? JSON.stringify(prepareSegmentAnnotationForReview(annotation, { segmentId, start, end }), null, 2)
      : ''
  ), [annotation, segmentId, start, end])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the editor when the selected segment changes
    setText(sourceText)
    setError([])
  }, [sourceText])

  const parsedPreview = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(text)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }, [text])

  const sourcePreview = useMemo(() => {
    if (!sourceText) return null
    const parsed: unknown = JSON.parse(sourceText)
    return isRecord(parsed) ? parsed : null
  }, [sourceText])
  const preview = parsedPreview || sourcePreview

  const groups = useMemo<ReviewGroupData[]>(() => {
    if (!preview) return []
    const persons = Array.isArray(preview.persons) ? preview.persons : []
    const allObjects = Array.isArray(preview.objects) ? preview.objects : []
    const ocrObjects = allObjects.filter(item => (
      isRecord(item) && ('_textContent' in item || item.category === 'text')
    ))
    const objects = allObjects.filter(item => !ocrObjects.includes(item))
    const events = Array.isArray(preview.events) ? preview.events : []
    const frames = Array.isArray(preview.frames) ? preview.frames : []
    const speechTranscript = typeof preview.speechTranscript === 'string' ? preview.speechTranscript : ''

    return [
      {
        key: 'segment',
        label: 'Segment Overview',
        description: 'Identity and exact time range for this segment.',
        value: { segmentId: preview.segmentId, start: preview.start, end: preview.end },
        defaultOpen: true,
      },
      {
        key: 'scene',
        label: 'Scene & Camera',
        description: 'Segment-level environment and camera semantics.',
        value: { scene: preview.scene, camera: preview.camera },
        defaultOpen: true,
      },
      {
        key: 'persons',
        label: 'Persons',
        description: 'Person identities, appearance, actions, clothing, and summary boxes.',
        value: persons,
        count: persons.length,
      },
      {
        key: 'objects',
        label: 'Objects',
        description: 'Non-text object tracks and their semantic attributes.',
        value: objects,
        count: objects.length,
      },
      {
        key: 'events',
        label: 'Visual Events',
        description: 'Short descriptions of activities visible in the segment.',
        value: events,
        count: events.length,
      },
      {
        key: 'text',
        label: 'OCR & Speech',
        description: 'Reviewed on-screen text and the segment speech transcript.',
        value: { speechTranscript, ocrObjects },
        count: ocrObjects.length + (speechTranscript ? 1 : 0),
      },
      {
        key: 'frames',
        label: 'Sampled Frames',
        description: 'Per-sampled-frame observations. Kept collapsed because this section can be large.',
        value: frames,
        count: frames.length,
      },
    ]
  }, [preview])

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-2 text-xs text-gv-text-muted underline hover:text-gv-pink"
      >
        Review Segment Data / Raw JSON
      </button>
    )
  }

  const normalizedQuery = query.trim().toLowerCase()
  const matchedGroups = groups.filter(group => containsQuery(group.label, group.value, normalizedQuery))

  const formatRawJson = () => {
    try {
      const parsed: unknown = JSON.parse(text)
      setText(JSON.stringify(parsed, null, 2))
      setError([])
    } catch (caught) {
      setError([`Invalid JSON: ${String(caught)}`])
    }
  }

  const applyRawJson = () => {
    try {
      const parsed: unknown = JSON.parse(text)
      const authoritative = isRecord(parsed)
        ? withAuthoritativeSegmentMetadata(parsed as unknown as SegmentAnnotation, { segmentId, start, end })
        : parsed
      const validationErrors = validateSegmentAnnotationReview(authoritative)
      if (validationErrors.length > 0) {
        setError(validationErrors)
        return
      }
      onSave(authoritative as SegmentAnnotation)
      setText(JSON.stringify(authoritative, null, 2))
      setError([])
    } catch (caught) {
      setError([`Invalid JSON: ${String(caught)}`])
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-gv-border bg-white/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gv-text">Segment Data Review</h3>
          <p className="mt-0.5 text-xs text-gv-text-muted">
            Review grouped annotation data here. Use Raw JSON only for advanced whole-segment edits.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded px-2 py-1 text-xs text-gv-text-dim hover:bg-gv-bg-deep"
        >
          Close
        </button>
      </div>

      <div className="mt-4 flex gap-2 border-b border-gv-border">
        <button
          type="button"
          onClick={() => setMode('review')}
          className={`border-b-2 px-3 py-2 text-xs font-medium ${mode === 'review' ? 'border-gv-pink text-gv-pink' : 'border-transparent text-gv-text-muted'}`}
        >
          Structured Review
        </button>
        <button
          type="button"
          onClick={() => setMode('raw')}
          className={`border-b-2 px-3 py-2 text-xs font-medium ${mode === 'raw' ? 'border-gv-pink text-gv-pink' : 'border-transparent text-gv-text-muted'}`}
        >
          Raw JSON (Advanced)
        </button>
      </div>

      {mode === 'review' ? (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {groups.map(group => (
              <div key={group.key} className="rounded-lg border border-gv-border bg-white/40 px-3 py-2">
                <p className="truncate text-[10px] uppercase tracking-wide text-gv-text-muted">{group.label}</p>
                <p className="mt-0.5 text-sm font-semibold text-gv-text">
                  {group.count ?? (group.key === 'segment' ? `S${String(preview?.segmentId ?? '?')}` : 'Ready')}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <label className="text-[11px] font-medium text-gv-text-dim" htmlFor="segment-json-search">Search fields or values</label>
            <input
              id="segment-json-search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="e.g. personId, chicken, speechTranscript"
              className="mt-1 w-full rounded-lg border border-gv-border bg-white/50 px-3 py-2 text-xs text-gv-text outline-none focus:border-gv-pink"
            />
          </div>

          {!parsedPreview && text && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Raw JSON currently contains a syntax error. This review preview is showing the last saved annotation.
            </p>
          )}

          <div className="mt-3 space-y-2">
            {matchedGroups.length > 0 ? matchedGroups.map(group => (
              <ReviewGroup key={group.key} group={group} query={normalizedQuery} />
            )) : (
              <p className="rounded-lg border border-gv-border px-3 py-6 text-center text-xs text-gv-text-muted">
                No fields or values match “{query}”.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <p className="mb-2 text-xs text-gv-text-muted">
            This is whole-segment internal data and may include all sampled frames, OCR, and speech. Saving replaces the complete human annotation after validation.
          </p>
          <textarea
            value={text}
            onChange={event => { setText(event.target.value); setError([]) }}
            className="h-[32rem] w-full resize-y rounded-lg border border-gv-border bg-gv-bg-deep p-3 font-mono text-xs focus:border-gv-pink focus:outline-none"
            spellCheck={false}
          />
          {error.length > 0 && (
            <div className="mt-2 rounded-lg border border-gv-pink/40 bg-gv-pink/5 px-3 py-2">
              <p className="text-xs font-medium text-gv-pink">Cannot apply this JSON</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-gv-pink">
                {error.slice(0, 12).map(message => <li key={message}>{message}</li>)}
              </ul>
              {error.length > 12 && <p className="mt-1 text-xs text-gv-pink">And {error.length - 12} more errors.</p>}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyRawJson}
              className="rounded bg-gv-green/20 px-3 py-1.5 text-xs font-medium text-gv-green-deep hover:bg-gv-green/30"
            >
              Validate &amp; Apply JSON
            </button>
            <button
              type="button"
              onClick={formatRawJson}
              className="btn-outline rounded px-3 py-1.5 text-xs"
            >
              Format JSON
            </button>
            <button
              type="button"
              onClick={() => { setText(sourceText); setError([]) }}
              className="btn-outline rounded px-3 py-1.5 text-xs"
            >
              Reset Unsaved Changes
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
