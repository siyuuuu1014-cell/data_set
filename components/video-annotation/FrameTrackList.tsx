'use client'

import { useMemo, useState } from 'react'
import { AnnotationCanvas } from './AnnotationCanvas'
import { personDisplayId, trackRefKey } from '@/services/video-annotation/frame-annotations'
import type { BBox, ObjectAnnotation, PersonAnnotation, SpatialEntityType } from '@/services/video-annotation/types'

interface Props {
  imageUrl: string
  persons: PersonAnnotation[]
  objects: ObjectAnnotation[]
  imgWidth: number
  imgHeight: number
  mode: 'view' | 'draw'
  drawEnabled: boolean
  pendingHiddenTrackKeys: Set<string>
  selectedTrackId: number | null
  selectedEntityType: SpatialEntityType | null
  onModeChange: (mode: 'view' | 'draw') => void
  onDrawBox: (box: BBox, imageWidth: number, imageHeight: number) => void
  onSelectTrack: (trackId: number, entityType: SpatialEntityType) => void
  onResizeBox: (trackId: number, entityType: SpatialEntityType, box: BBox, imageWidth: number, imageHeight: number) => void
  onDeleteTrack: (trackId: number, entityType: SpatialEntityType) => void
}

export function FrameTrackList(props: Props) {
  const [open, setOpen] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const canvasHidden = useMemo(
    () => new Set([...props.pendingHiddenTrackKeys, ...hidden]),
    [props.pendingHiddenTrackKeys, hidden],
  )
  const rows = useMemo(() => [
    ...props.persons.map(person => ({
      key: trackRefKey({ entityType: 'person', trackId: person.trackId }),
      entityType: 'person' as const,
      trackId: person.trackId,
      identity: personDisplayId(person.personId, person.trackId),
      label: person.gender && person.gender !== 'unknown' ? person.gender : 'person',
      confidence: person._detectionConfidence,
    })),
    ...props.objects.map(object => ({
      key: trackRefKey({ entityType: 'object', trackId: object.trackId }),
      entityType: 'object' as const,
      trackId: object.trackId,
      identity: `O-${object.trackId}`,
      label: object.name || 'object',
      confidence: object._detectionConfidence,
    })),
  ], [props.persons, props.objects])

  const toggleHidden = (key: string) => setHidden(current => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  return <div className="space-y-2">
    <section className="overflow-hidden rounded-lg border border-gv-border bg-white/35">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-gv-text">
          Current Frame Tracks <span className="text-gv-text-muted">({rows.length})</span>
        </span>
        <span aria-hidden="true" className="text-xs text-gv-text-muted">{open ? '-' : '+'}</span>
      </button>
      {open && <div className="grid max-h-44 gap-1 overflow-auto border-t border-gv-border p-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.length === 0
          ? <p className="col-span-full px-2 py-3 text-center text-xs text-gv-text-muted">No tracks in this frame.</p>
          : rows.map(row => {
            const selected = props.selectedTrackId === row.trackId && props.selectedEntityType === row.entityType
            const isHidden = hidden.has(row.key)
            return <div
              key={row.key}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${selected ? 'border-gv-pink bg-gv-pink/10' : 'border-gv-border/60 bg-white/40'}`}
            >
              <button
                type="button"
                onClick={() => props.onSelectTrack(row.trackId, row.entityType)}
                className="min-w-0 flex-1 text-left"
                title={`Select ${row.entityType} ${row.trackId}`}
              >
                <span className="block truncate text-[11px] font-semibold text-gv-text">{row.identity} / {row.label}</span>
                <span className="block text-[10px] text-gv-text-muted">
                  {row.entityType} / Track {row.trackId}{row.confidence == null ? '' : ` / ${Math.round(row.confidence * 100)}%`}
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleHidden(row.key)}
                className={`rounded px-1.5 py-1 text-[10px] ${isHidden ? 'bg-gv-gold/15 text-gv-gold-dark' : 'text-gv-text-muted hover:bg-gv-bg-deep'}`}
                title={isHidden ? 'Show this box' : 'Temporarily hide this box'}
              >
                {isHidden ? 'Show' : 'Hide'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete ${row.identity} from this frame?`)) {
                    props.onDeleteTrack(row.trackId, row.entityType)
                  }
                }}
                className="rounded px-1.5 py-1 text-[10px] text-gv-pink hover:bg-gv-pink/10"
                title="Delete this frame box"
              >
                Delete
              </button>
            </div>
          })}
      </div>}
    </section>
    <AnnotationCanvas
      imageUrl={props.imageUrl}
      persons={props.persons}
      objects={props.objects}
      imgWidth={props.imgWidth}
      imgHeight={props.imgHeight}
      mode={props.mode}
      drawEnabled={props.drawEnabled}
      hiddenTrackKeys={canvasHidden}
      onModeChange={props.onModeChange}
      onDrawBox={props.onDrawBox}
      onSelectTrack={props.onSelectTrack}
      onResizeBox={props.onResizeBox}
      selectedTrackId={props.selectedTrackId}
      selectedEntityType={props.selectedEntityType}
    />
  </div>
}
