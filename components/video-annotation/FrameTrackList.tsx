'use client'

import { useMemo, useState } from 'react'
import { AnnotationCanvas } from './AnnotationCanvas'
import { personDisplayId, trackRefKey } from '@/services/video-annotation/frame-annotations'
import { useLang } from '@/services/i18n'
import { useConfirm } from '@/components/ui'
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
  const { t } = useLang()
  const confirmAction = useConfirm()
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
    <section className="overflow-hidden rounded-lg border border-ui-border bg-ui-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-gv-text">
          {t('annotation.current_frame_tracks')} <span className="text-gv-text-muted">({rows.length})</span>
        </span>
        <svg className={`h-3.5 w-3.5 text-gv-text-muted transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="grid gap-1 border-t border-gv-border p-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.length === 0
          ? <p className="col-span-full px-2 py-3 text-center text-xs text-gv-text-muted">{t('annotation.no_tracks')}</p>
          : rows.map(row => {
            const selected = props.selectedTrackId === row.trackId && props.selectedEntityType === row.entityType
            const isHidden = hidden.has(row.key)
            return <div
              key={row.key}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${selected ? 'border-ui-active-indicator bg-ui-icon-accent-soft' : 'border-ui-border bg-ui-surface'}`}
            >
              <button
                type="button"
                onClick={() => props.onSelectTrack(row.trackId, row.entityType)}
                className="min-w-0 flex-1 text-left"
                title={t('annotation.select_track', row.entityType === 'person' ? t('video.person_label') : t('video.object_label'), row.trackId)}
              >
                <span className="block truncate text-[11px] font-semibold text-gv-text">{row.identity} / {row.label}</span>
                <span className="block text-[10px] text-gv-text-muted">
                  {t('annotation.track_meta', row.entityType === 'person' ? t('video.person_label') : t('video.object_label'), row.trackId)}{row.confidence == null ? '' : ` · ${Math.round(row.confidence * 100)}%`}
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleHidden(row.key)}
                className={`rounded px-1.5 py-1 text-[10px] ${isHidden ? 'bg-gv-gold/15 text-gv-gold-dark' : 'text-gv-text-muted hover:bg-gv-bg-deep'}`}
                title={isHidden ? t('annotation.show_box') : t('annotation.hide_box')}
              >
                {isHidden ? t('annotation.show') : t('annotation.hide')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (await confirmAction({ message: t('annotation.delete_frame_box_confirm', row.identity), confirmLabel: t('app.delete'), tone: 'danger' })) {
                    props.onDeleteTrack(row.trackId, row.entityType)
                  }
                }}
                className="rounded px-1.5 py-1 text-[10px] text-gv-pink hover:bg-gv-pink/10"
                title={t('annotation.delete_frame_box')}
              >
                {t('annotation.delete')}
              </button>
            </div>
          })}
      </div>}
    </section>
  </div>
}
