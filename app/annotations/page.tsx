'use client'

import { useCallback, useEffect, useState } from 'react'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { AnnotateSetCard } from '@/components/video-annotation/AnnotateSetCard'
import { useLang } from '@/services/i18n'
import type { AnnotateSet } from '@/services/video-annotation/types'

const VIDEO_WORKSPACE_ID = 'video-annotation'

export default function VideoAnnotationPage() {
  const { t } = useLang()
  const [sets, setSets] = useState<AnnotateSet[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const loadSets = useCallback(async () => {
    try {
      const response = await fetch('/api/video-annotation/annotate-sets')
      if (response.ok) {
        const payload = await response.json() as { data?: AnnotateSet[] }
        setSets(payload.data || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSets()
  }, [loadSets])

  const createSet = async () => {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const response = await fetch('/api/video-annotation/annotate-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: VIDEO_WORKSPACE_ID, name: newName.trim() }),
      })
      if (response.ok) {
        const { data } = await response.json() as { data: AnnotateSet }
        setSets(current => [data, ...current])
        setNewName('')
        setShowNew(false)
      }
    } finally {
      setCreating(false)
    }
  }

  const removeSet = async (setId: string) => {
    const response = await fetch(`/api/video-annotation/annotate-sets/${setId}`, { method: 'DELETE' })
    if (response.ok) setSets(current => current.filter(set => set.id !== setId))
  }

  return (
    <div className="flex-1 flex flex-col">
      <WorkspaceHeader />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-[0.18em] text-gv-pink font-semibold">{t('workspace.video')}</span>
            <span className="h-px flex-1 bg-gv-border/70" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gv-text">{t('video.title')}</h1>
              <p className="text-sm text-gv-text-dim mt-1 max-w-2xl">{t('video.description')}</p>
            </div>
            <button onClick={() => setShowNew(true)} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center justify-center gap-1 flex-shrink-0">
              + {t('video.new_set')}
            </button>
          </div>
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm text-gv-text-dim">{t('app.loading')}</div>
        ) : sets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gv-text-dim">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gv-pink/10 to-gv-green/10 flex items-center justify-center mb-4 border border-gv-border">
              <svg className="w-8 h-8 text-gv-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-base font-medium">{t('video.no_sets')}</p>
            <p className="text-sm mt-1">{t('video.no_sets_desc')}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((set, index) => <AnnotateSetCard key={set.id} set={set} index={index} onDelete={removeSet} />)}
          </div>
        )}
      </main>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={() => setShowNew(false)}>
          <div className="glass-raised rounded-xl w-full max-w-md mx-4 p-6" onClick={event => event.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gv-text mb-1">{t('video.new_set')}</h2>
            <p className="text-sm text-gv-text-dim mb-4">{t('video.new_set_desc')}</p>
            <input
              type="text"
              value={newName}
              onChange={event => setNewName(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') createSet() }}
              placeholder={t('video.name_placeholder')}
              className="input-field w-full mb-5"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowNew(false); setNewName('') }} className="btn-outline rounded-lg px-4 py-2 text-sm">{t('app.cancel')}</button>
              <button onClick={createSet} disabled={!newName.trim() || creating} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50">
                {creating ? t('video.creating') : t('app.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
