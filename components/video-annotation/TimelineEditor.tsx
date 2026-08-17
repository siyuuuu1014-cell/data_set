'use client'

import { useState } from 'react'
import type { AnnotateSet, SegmentState, VideoTaskItem } from '@/services/video-annotation/types'
import { useLang } from '@/services/i18n'
import { useConfirm } from '@/components/ui'

export function TimelineEditor({ annotateSetId, video, segment, initialTime, onUpdate }: {
  annotateSetId: string
  video: VideoTaskItem
  segment: SegmentState
  initialTime: number
  onUpdate: (task: AnnotateSet) => void
}) {
  const { t } = useLang()
  const confirmAction = useConfirm()
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState(initialTime)
  const [preserve, setPreserve] = useState<'left' | 'right' | 'none'>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ordered = [...video.segments].sort((a, b) => a.start - b.start || a.end - b.end)
  const hasNext = ordered.findIndex(item => item.segmentId === segment.segmentId) < ordered.length - 1

  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/video-annotation/annotate-sets/${annotateSetId}/segments/timeline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: video.videoId, ...body }) })
      const payload = await response.json() as { data?: AnnotateSet; error?: { message?: string } }
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || t('annotation.timeline_failed'))
      onUpdate(payload.data)
    } catch (caught) { setError(String(caught)) } finally { setBusy(false) }
  }

  return <section className="mb-3 rounded-lg border border-ui-border bg-ui-surface">
    <button type="button" aria-expanded={open} onClick={() => setOpen(current => !current)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-gv-text">
      <span>{t('annotation.timeline_tools')} <span className="text-gv-text-muted">({t('annotation.undo_snapshots', video.timelineHistory?.length || 0)})</span></span>
      <svg className={`h-3.5 w-3.5 text-gv-text-muted transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <div className="space-y-3 border-t border-gv-border p-3">
      <p className="text-[11px] text-gv-text-muted">{t('annotation.timeline_desc')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gv-text-muted">{t('annotation.time')}</label><input type="number" value={time} min={segment.start} max={segment.end} step={1 / Math.max(video.fps || 30, 1)} onChange={event => setTime(Number(event.target.value))} className="w-28 rounded border border-ui-border bg-ui-surface px-2 py-1 font-mono text-xs" />
        <label className="text-xs text-gv-text-muted">{t('annotation.preserve')}</label><select value={preserve} onChange={event => setPreserve(event.target.value as typeof preserve)} className="rounded border border-ui-border bg-ui-surface px-2 py-1 text-xs"><option value="none">{t('annotation.preserve_none')}</option><option value="left">{t('annotation.preserve_left')}</option><option value="right">{t('annotation.preserve_right')}</option></select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={async () => { if (await confirmAction(t('annotation.split_confirm'))) void mutate({ action: 'split', segmentId: segment.segmentId, time, preserve }) }} className="btn-outline rounded px-2 py-1 text-xs disabled:opacity-40">{t('annotation.split_here')}</button>
        <button type="button" disabled={busy || !hasNext} onClick={async () => { if (await confirmAction(t('annotation.adjust_confirm'))) void mutate({ action: 'adjust', segmentId: segment.segmentId, time }) }} className="btn-outline rounded px-2 py-1 text-xs disabled:opacity-40">{t('annotation.adjust_boundary')}</button>
        <button type="button" disabled={busy || !hasNext} onClick={async () => { if (await confirmAction(t('annotation.merge_confirm'))) void mutate({ action: 'merge', segmentId: segment.segmentId, preserve }) }} className="btn-outline rounded px-2 py-1 text-xs disabled:opacity-40">{t('annotation.merge_next')}</button>
        <button type="button" disabled={busy || !(video.timelineHistory?.length)} onClick={() => void mutate({ action: 'undo' })} className="rounded bg-gv-gold/10 px-2 py-1 text-xs text-gv-gold-dark disabled:opacity-40">{t('annotation.undo_timeline')}</button>
      </div>
      {error && <p className="text-xs text-gv-pink">{error}</p>}
    </div>}
  </section>
}
