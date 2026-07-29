'use client'

import { useMemo, useState } from 'react'
import { collectVideoIdentities } from '@/services/video-annotation/identity-review'
import type { AnnotateSet, VideoTaskItem } from '@/services/video-annotation/types'

export function IdentityManager({ annotateSetId, video, selectedSegmentId, selectedTrackId, onUpdate }: {
  annotateSetId: string
  video: VideoTaskItem
  selectedSegmentId: number | null
  selectedTrackId: number | null
  onUpdate: (task: AnnotateSet) => void
}) {
  const identities = useMemo(() => collectVideoIdentities(video), [video])
  const [open, setOpen] = useState(false)
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/video-annotation/annotate-sets/${annotateSetId}/identities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: video.videoId, ...body }) })
      const payload = await response.json() as { data?: AnnotateSet; error?: { message?: string } }
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || 'Identity update failed')
      onUpdate(payload.data); setSourceId(''); setTargetId('')
    } catch (caught) { setError(String(caught)) } finally { setBusy(false) }
  }

  return (
    <section className="mb-3 rounded-lg border border-gv-border bg-white/30">
      <button type="button" onClick={() => setOpen(current => !current)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-gv-text">
        <span>Person Identities <span className="text-gv-text-muted">({identities.length})</span></span><span>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="space-y-3 border-t border-gv-border p-3">
        <p className="text-[11px] text-gv-text-muted">Human merges, splits, and locks are reapplied after model reruns.</p>
        <div className="max-h-40 space-y-1 overflow-auto">
          {identities.map(identity => <div key={identity.personId} className="flex items-center gap-2 rounded border border-gv-border/60 px-2 py-1.5 text-[11px]">
            <span className="min-w-0 flex-1 truncate font-mono" title={identity.personId}>{identity.personId}</span>
            <span className="text-gv-text-muted">S{identity.segments.join(', S')}</span>
            <button type="button" disabled={busy} onClick={() => void mutate({ action: 'lock', personId: identity.personId, locked: !identity.locked })} className={`rounded px-2 py-0.5 ${identity.locked ? 'bg-gv-pink/10 text-gv-pink' : 'bg-gv-bg-deep text-gv-text-muted'}`}>{identity.locked ? 'Locked' : 'Lock'}</button>
          </div>)}
        </div>
        {identities.length >= 2 && <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <select value={sourceId} onChange={event => setSourceId(event.target.value)} className="rounded border border-gv-border bg-white/50 px-2 py-1 text-xs"><option value="">Merge from…</option>{identities.map(item => <option key={item.personId} value={item.personId}>{item.personId}</option>)}</select>
          <select value={targetId} onChange={event => setTargetId(event.target.value)} className="rounded border border-gv-border bg-white/50 px-2 py-1 text-xs"><option value="">Merge into…</option>{identities.map(item => <option key={item.personId} value={item.personId}>{item.personId}</option>)}</select>
          <button type="button" disabled={busy || !sourceId || !targetId || sourceId === targetId} onClick={() => { if (confirm('Merge these identities? This human decision will survive reruns.')) void mutate({ action: 'merge', sourceId, targetId }) }} className="btn-outline rounded px-2 py-1 text-xs disabled:opacity-40">Merge</button>
        </div>}
        <button type="button" disabled={busy || selectedSegmentId == null || selectedTrackId == null} onClick={() => { if (confirm('Split the selected track into a new locked person identity?')) void mutate({ action: 'split', segmentId: selectedSegmentId, trackId: selectedTrackId }) }} className="btn-outline rounded px-2 py-1 text-xs disabled:opacity-40">Split Selected Person into New Identity</button>
        {error && <p className="text-xs text-gv-pink">{error}</p>}
      </div>}
    </section>
  )
}
