'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { SlidingControl } from '@/components/ui'
import { AnnotateSetCard } from '@/components/video-annotation/AnnotateSetCard'
import { useLang } from '@/services/i18n'
import { deriveAnnotateSetStatus } from '@/services/video-annotation/status'
import type { AnnotateSet, AnnotateSetStatus } from '@/services/video-annotation/types'
import styles from './annotations.module.css'

const VIDEO_WORKSPACE_ID = 'video-annotation'

type StatusFilter = 'all' | 'pending' | 'review' | 'completed'
type SortMode = 'risk' | 'newest'

const RISK_RANK: Record<AnnotateSetStatus, number> = {
  failed: 6,
  partial_completed: 5,
  awaiting_review: 4,
  awaiting_segment_review: 4,
  cancelled: 3,
  validating: 2,
  annotating: 2,
  splitting: 2,
  uploading: 2,
  draft: 1,
  approved: 0,
  completed: 0,
}

function statusGroup(status: AnnotateSetStatus): Exclude<StatusFilter, 'all'> {
  if (status === 'approved' || status === 'completed') return 'completed'
  if (
    status === 'awaiting_review'
    || status === 'awaiting_segment_review'
    || status === 'partial_completed'
    || status === 'failed'
    || status === 'cancelled'
  ) return 'review'
  return 'pending'
}

async function fetchAnnotateSets(): Promise<AnnotateSet[]> {
  const response = await fetch('/api/video-annotation/annotate-sets')
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  const payload = await response.json() as { data?: AnnotateSet[] }
  if (!Array.isArray(payload.data)) throw new Error('Invalid annotation project response')
  return payload.data
}

export default function VideoAnnotationPage() {
  const { t, lang } = useLang()
  const [sets, setSets] = useState<AnnotateSet[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('risk')

  const loadSets = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setSets(await fetchAnnotateSets())
    } catch {
      setLoadError(t('video.load_error_desc'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    let active = true
    void fetchAnnotateSets()
      .then(data => {
        if (active) setSets(data)
      })
      .catch(() => {
        if (active) setLoadError(t('video.load_error_desc'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [t])

  const createSet = async () => {
    if (!newName.trim() || creating) return
    setCreating(true)
    setActionError('')
    try {
      const response = await fetch('/api/video-annotation/annotate-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: VIDEO_WORKSPACE_ID, name: newName.trim() }),
      })
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
      const payload = await response.json() as { data?: AnnotateSet }
      if (!payload.data) throw new Error('Invalid annotation project response')
      setSets(current => [payload.data as AnnotateSet, ...current])
      setNewName('')
      setShowNew(false)
    } catch {
      setActionError(t('video.create_error'))
    } finally {
      setCreating(false)
    }
  }

  const removeSet = async (setId: string) => {
    if (deletingId) return
    setDeletingId(setId)
    setActionError('')
    try {
      const response = await fetch(`/api/video-annotation/annotate-sets/${setId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
      setSets(current => current.filter(set => set.id !== setId))
    } catch {
      setActionError(t('video.delete_error'))
    } finally {
      setDeletingId(null)
    }
  }

  const filteredSets = useMemo(() => {
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
    const normalizedQuery = query.trim().toLocaleLowerCase(locale)
    return sets
      .filter(set => {
        if (!normalizedQuery) return true
        return set.name.toLocaleLowerCase(locale).includes(normalizedQuery)
          || set.videos.some(video => video.fileName.toLocaleLowerCase(locale).includes(normalizedQuery))
      })
      .filter(set => statusFilter === 'all' || statusGroup(deriveAnnotateSetStatus(set)) === statusFilter)
      .sort((left, right) => {
        if (sortMode === 'newest') return Date.parse(right.createdAt) - Date.parse(left.createdAt)
        const riskDifference = RISK_RANK[deriveAnnotateSetStatus(right)] - RISK_RANK[deriveAnnotateSetStatus(left)]
        return riskDifference || Date.parse(right.createdAt) - Date.parse(left.createdAt)
      })
  }, [lang, query, sets, sortMode, statusFilter])

  const resetFilters = () => {
    setQuery('')
    setStatusFilter('all')
    setSortMode('risk')
  }

  const videoCount = sets.reduce((total, set) => total + set.videos.length, 0)
  const reviewCount = sets.filter(set => statusGroup(deriveAnnotateSetStatus(set)) === 'review').length

  return (
    <div className={styles.pageRoot}>
      <WorkspaceHeader />

      <main className={styles.pageContent}>
        <section className={styles.pageIntro}>
          <div className={styles.titleBlock}>
            <h1>{t('video.list_title')}</h1>
            <p>{t('video.description')}</p>
          </div>
          <button type="button" onClick={() => { setActionError(''); setShowNew(true) }} className={styles.primaryAction}>
            <span aria-hidden="true">+</span>
            {t('video.new_set')}
          </button>
        </section>

        <dl className={styles.overview} aria-label={t('video.project_summary', sets.length, videoCount)}>
          <div className={styles.metric}><span>{t('video.sets')}</span><strong>{sets.length}</strong></div>
          <div className={styles.metric}><span>{t('video.videos')}</span><strong>{videoCount}</strong></div>
          <div className={`${styles.metric} ${styles.metricComplete}`}><span>{t('video.filter.review')}</span><strong>{reviewCount}</strong></div>
        </dl>

        <section className={styles.projectSection}>
          <div className={styles.sectionHeader}>
            <h2>{t('video.sets')}</h2>
            <SlidingControl
              value={viewMode}
              options={[
                {
                  value: 'grid',
                  ariaLabel: t('video.grid_view'),
                  label: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>,
                },
                {
                  value: 'list',
                  ariaLabel: t('video.list_view'),
                  label: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="18" r="1" fill="currentColor" stroke="none" /></svg>,
                },
              ]}
              onChange={setViewMode}
              label={t('video.view_mode')}
              className={styles.viewSlider}
              compact
            />
          </div>

          {!loading && !loadError && sets.length > 0 && (
            <div className={styles.directoryToolbar}>
              <label className={styles.searchField}>
                <span>{t('app.search')}</span>
                <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('video.search_placeholder')} />
              </label>
              <SlidingControl
                value={statusFilter}
                options={(['all', 'pending', 'review', 'completed'] as const).map(option => ({ value: option, label: t(`video.filter.${option}`) }))}
                onChange={setStatusFilter}
                label={t('video.filter_label')}
                className={styles.filterSlider}
              />
              <label className={styles.sortField}>
                <span>{t('video.sort_label')}</span>
                <select value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)}>
                  <option value="risk">{t('video.sort.risk')}</option>
                  <option value="newest">{t('video.sort.newest')}</option>
                </select>
              </label>
            </div>
          )}

          {actionError && <p className={styles.inlineError} role="alert">{actionError}</p>}

          {loading ? (
            <div className={`${styles.loadingGrid} ${viewMode === 'list' ? styles.loadingGridList : ''}`} role="status" aria-live="polite" aria-label={t('app.loading')}>
              {[0, 1, 2].map(item => <div className={styles.loadingCard} key={item}><i /><span /><span /><b /></div>)}
              <span className={styles.srOnly}>{t('app.loading')}</span>
            </div>
          ) : loadError ? (
            <div className={styles.loadError} role="alert">
              <div><strong>{t('video.load_error')}</strong><p>{loadError}</p></div>
              <button type="button" onClick={() => void loadSets()}>{t('state.retry')}</button>
            </div>
          ) : sets.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon} aria-hidden="true">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <strong>{t('video.no_sets')}</strong>
              <p>{t('video.no_sets_desc')}</p>
              <button type="button" onClick={() => setShowNew(true)} className={styles.emptyAction}>{t('video.new_set')}</button>
            </div>
          ) : filteredSets.length === 0 ? (
            <div className={styles.noResults} aria-live="polite">
              <strong>{t('video.no_results')}</strong>
              <p>{t('video.no_results_desc')}</p>
              <button type="button" onClick={resetFilters}>{t('video.reset_filters')}</button>
            </div>
          ) : (
            <div className={`${styles.projectGrid} ${viewMode === 'list' ? styles.projectGridList : ''}`}>
              {viewMode === 'list' && (
                <div className={styles.queueHeader} aria-hidden="true">
                  <span>{t('video.sets')}</span>
                  <span>{t('video.directory_scope')}</span>
                  <span>{t('video.directory_status')}</span>
                  <span>{t('video.directory_created')}</span>
                  <span>{t('video.directory_next')}</span>
                </div>
              )}
              {filteredSets.map((set, index) => (
                <AnnotateSetCard key={set.id} set={set} index={index} onDelete={removeSet} deleting={deletingId === set.id} />
              ))}
            </div>
          )}
        </section>
      </main>

      {showNew && (
        <div className={styles.modalBackdrop} onClick={() => !creating && setShowNew(false)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="new-annotation-project-title" onClick={event => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalIcon} aria-hidden="true">N</span>
              <div><h2 id="new-annotation-project-title">{t('video.new_set')}</h2><p>{t('video.new_set_desc')}</p></div>
            </div>
            {actionError && <p className={styles.inlineError} role="alert">{actionError}</p>}
            <input
              type="text"
              value={newName}
              onChange={event => { setNewName(event.target.value); setActionError('') }}
              onKeyDown={event => { if (event.key === 'Enter') void createSet() }}
              placeholder={t('video.name_placeholder')}
              className={styles.modalInput}
              disabled={creating}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button type="button" onClick={() => { setShowNew(false); setNewName(''); setActionError('') }} disabled={creating} className={styles.secondaryAction}>{t('app.cancel')}</button>
              <button type="button" onClick={() => void createSet()} disabled={!newName.trim() || creating} className={styles.primaryAction}>
                {creating ? t('video.creating') : t('app.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
