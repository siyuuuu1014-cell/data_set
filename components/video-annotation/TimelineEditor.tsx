'use client'

import { useState } from 'react'
import type { AnnotateSet, SegmentState, VideoTaskItem } from '@/services/video-annotation/types'

export function TimelineEditor({ annotateSetId, video, segment, initialTime, onUpdate }: {
  annotateSetId: string
  video: VideoTaskItem
  segment: SegmentState
  initialTime: number
  onUpdate: (task: AnnotateSet) => void
}) {
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
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || 'Timeline update failed')
      onUpdate(payload.data)
    } catch (caught) { setError(String(caught)) } finally { setBusy(false) }
  }

  return <section className="mb-3 rounded-lg border border-gv-border bg-white/30">
    <button type="button" onClick={() => setOpen(current => !current)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-gv-text"><span>Timeline Tools <span className="text-gv-text-muted">({video.timelineHistory?.length || 0} undo snapshots)</span></span><span>{open ? '▾' : '▸'}</span></button>
    {open && <div className="space-y-3 border-t border-gv-border p-3">
      <p className="text-[11px] text-gv-text-muted">Every change saves a complete snapshot. Preserved annotations are trimmed to the new time range and marked Needs Review.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gv-text-muted">Time</label><input type="number" value={time} min={segment.start} max={segment.end} step={1 / Math.max(video.fps || 30, 1)} onChange={event => setTime(Number(event.target.value))} className="w-28 rounded border border-gv-border bg-white/50 px-2 py-1 font-mono text-xs" />
        <label className="text-xs text-gv-text-muted">Preserve</label><select value={preserve} onChange={event => setPreserve(event.target.value as typeof preserve)} className="rounded border border-gv-border bg-white/50 px-2 py-1 text-xs"><option value="none">Neither (re-run)</option><option value="left">Left result</option><option value="right">Right result</option></select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => { if (confirm('Split this annotated segment? A snapshot will be saved first.')) void mutate({ action: 'split', segmentId: segment.segmentId, time, preserve }) }} className="btn-outline rounded px-2 py-1 text-xs disabled:opacity-40">Split Here</button>
        <button type="button" disabled={busy || !hasNext} onClick={() => { if (confirm('Move the boundary with the following segment?')) void mutate({ action: 'adjust', segmentId: segment.segmentId, time }) }} className="btn-outline rounded px-2 py-1 text-xs disabled:opacity-40">Move Next Boundary Here</button>
        <button type="button" disabled={busy || !hasNext} onClick={() => { if (confirm('Merge this segment with the following segment?')) void mutate({ action: 'merge', segmentId: segment.segmentId, preserve }) }} className="btn-outline rounded px-2 py-1 text-xs disabled:opacity-40">Merge with Next</button>
        <button type="button" disabled={busy || !(video.timelineHistory?.length)} onClick={() => void mutate({ action: 'undo' })} className="rounded bg-gv-gold/10 px-2 py-1 text-xs text-gv-gold-dark disabled:opacity-40">Undo Last Timeline Edit</button>
      </div>
      {error && <p className="text-xs text-gv-pink">{error}</p>}
    </div>}
  </section>
}
