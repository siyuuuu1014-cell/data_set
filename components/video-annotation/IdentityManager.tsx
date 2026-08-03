'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLang } from '@/services/i18n'
import { useConfirm } from '@/components/ui'
import { collectVideoIdentities } from '@/services/video-annotation/identity-review'
import type { AnnotateSet, VideoTaskItem } from '@/services/video-annotation/types'
import styles from './identity-manager.module.css'

type IdentityAction = 'lock' | 'merge' | 'split'

export function IdentityManager({ annotateSetId, video, selectedSegmentId, selectedTrackId, onUpdate, embedded = false }: {
  annotateSetId: string
  video: VideoTaskItem
  selectedSegmentId: number | null
  selectedTrackId: number | null
  onUpdate: (task: AnnotateSet) => void
  embedded?: boolean
}) {
  const { t } = useLang()
  const confirmAction = useConfirm()
  const identities = useMemo(() => collectVideoIdentities(video), [video])
  const selectedTrackPersonId = useMemo(() => {
    if (selectedSegmentId == null || selectedTrackId == null) return null
    const segment = video.segments.find(item => item.segmentId === selectedSegmentId)
    const annotation = segment?.humanAnnotation || segment?.modelAnnotation
    return annotation?.persons.find(person => person.trackId === selectedTrackId)?.personId || null
  }, [video, selectedSegmentId, selectedTrackId])

  const [open, setOpen] = useState(false)
  const [selectedIdentityId, setSelectedIdentityId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [busyAction, setBusyAction] = useState<IdentityAction | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)

  const effectiveSelectedId = identities.some(identity => identity.personId === selectedIdentityId)
    ? selectedIdentityId
    : selectedTrackPersonId && identities.some(identity => identity.personId === selectedTrackPersonId)
      ? selectedTrackPersonId
      : identities[0]?.personId || ''
  const current = identities.find(identity => identity.personId === effectiveSelectedId) || null
  const mergeTargets = current ? identities.filter(identity => identity.personId !== current.personId) : []
  const mergeTarget = mergeTargets.some(identity => identity.personId === targetId)
    ? targetId
    : mergeTargets[0]?.personId || ''
  const managerOpen = embedded || open

  useEffect(() => {
    busyRef.current = busyAction !== null
  }, [busyAction])

  const closeManager = useCallback(() => {
    if (busyRef.current) return
    setOpen(false)
    setError('')
    setSuccess('')
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!managerOpen || embedded) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeManager()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [managerOpen, embedded, closeManager])

  const mutate = async (action: IdentityAction, body: Record<string, unknown>) => {
    if (busyAction) return
    setBusyAction(action)
    setError('')
    setSuccess('')
    try {
      const response = await fetch(`/api/video-annotation/annotate-sets/${annotateSetId}/identities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.videoId, ...body }),
      })
      const payload = await response.json() as { data?: AnnotateSet; personId?: string; error?: { message?: string } }
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || t('video.identity_update_failed'))

      if (action === 'merge' && typeof body.targetId === 'string') setSelectedIdentityId(body.targetId)
      if (action === 'split' && payload.personId) setSelectedIdentityId(payload.personId)
      onUpdate(payload.data)
      setSuccess(t(`video.identity_${action}_success`))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('video.identity_update_failed'))
    } finally {
      setBusyAction(null)
    }
  }

  const selectIdentity = (personId: string) => {
    setSelectedIdentityId(personId)
    setTargetId('')
    setError('')
    setSuccess('')
  }

  return (
    <>
      {!embedded && (
        <button
          ref={triggerRef}
          type="button"
          className={styles.trigger}
          onClick={() => {
            if (open) {
              closeManager()
              return
            }
            setError('')
            setSuccess('')
            if (selectedTrackPersonId) setSelectedIdentityId(selectedTrackPersonId)
            setOpen(true)
          }}
          aria-expanded={open}
        >
          <span>
            <strong>{t('video.identity_title')}</strong>
            <small>{t('video.identity_count', identities.length)}</small>
          </span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="m9 6 6 6-6 6" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {managerOpen && (
        <section className={`${styles.panel} ${embedded ? styles.panelEmbedded : ''}`} aria-labelledby="identity-manager-title" aria-busy={busyAction !== null}>
          <header className={styles.pageHeader}>
            <div>
              <h2 id="identity-manager-title">{t('video.identity_title')}</h2>
              <p>{t('video.identity_desc')}</p>
            </div>
            {!embedded && (
              <button ref={closeRef} type="button" onClick={closeManager} disabled={busyAction !== null}>
                {t('video.identity_back')}
              </button>
            )}
          </header>

          {identities.length === 0 ? (
            <section className={styles.emptyState}>
              <h3>{t('video.identity_empty_title')}</h3>
              <p>{t('video.identity_empty_desc')}</p>
              {!embedded && <button type="button" onClick={closeManager}>{t('video.identity_back_pipeline')}</button>}
            </section>
          ) : (
            <div className={styles.workspace}>
              <aside className={styles.directory}>
                <div className={styles.directoryHeader}>
                  <strong>{t('video.identity_directory')}</strong>
                  <span>{t('video.identity_count', identities.length)}</span>
                </div>
                <div className={styles.identityList} role="tablist" aria-label={t('video.identity_directory')}>
                  {identities.map(identity => (
                    <button
                      type="button"
                      role="tab"
                      id={`identity-tab-${identity.personId}`}
                      aria-controls="identity-decision-panel"
                      aria-selected={current?.personId === identity.personId}
                      key={identity.personId}
                      onClick={() => selectIdentity(identity.personId)}
                    >
                      <strong title={identity.personId}>{identity.personId}</strong>
                      <small title={t('video.identity_segments', identity.segments.join(', '))}>
                        {t('video.identity_segments', identity.segments.join(', '))}
                      </small>
                      <span>{identity.locked ? t('video.identity_locked') : t('video.identity_tracks', identity.tracks.length)}</span>
                    </button>
                  ))}
                </div>
              </aside>

              {current && (
                <section
                  className={styles.decision}
                  id="identity-decision-panel"
                  role="tabpanel"
                  aria-labelledby={`identity-tab-${current.personId}`}
                >
                  <header>
                    <div>
                      <span>{t('video.identity_current')}</span>
                      <h3 title={current.personId}>{current.personId}</h3>
                      <p>{t('video.identity_current_summary', current.segments.join(', '), current.tracks.length)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void mutate('lock', { action: 'lock', personId: current.personId, locked: !current.locked })}
                    >
                      {busyAction === 'lock'
                        ? t('video.identity_saving')
                        : current.locked
                          ? t('video.identity_unlock')
                          : t('video.identity_lock')}
                    </button>
                  </header>

                  <div className={styles.actionBlock}>
                    <div>
                      <h4>{t('video.identity_merge_title')}</h4>
                      <p>{t('video.identity_merge_desc')}</p>
                    </div>
                    <div className={styles.mergeFlow}>
                      <div className={styles.identitySource}>
                        <span>{t('video.identity_source')}</span>
                        <strong title={current.personId}>{current.personId}</strong>
                      </div>
                      <span>{t('video.identity_merge_into')}</span>
                      <label>
                        <span>{t('video.identity_target')}</span>
                        <select
                          value={mergeTarget}
                          onChange={event => {
                            setTargetId(event.target.value)
                            setError('')
                            setSuccess('')
                          }}
                          disabled={busyAction !== null || mergeTargets.length === 0}
                        >
                          {mergeTargets.map(identity => (
                            <option key={identity.personId} value={identity.personId}>{identity.personId}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className={styles.commitRow}>
                      <p>{mergeTarget ? t('video.identity_merge_impact', current.personId, mergeTarget) : t('video.identity_merge_unavailable')}</p>
                      <button
                        type="button"
                        className={styles.primaryAction}
                        disabled={busyAction !== null || !mergeTarget}
                        onClick={async () => {
                          if (!mergeTarget) return
                          if (await confirmAction(t('video.identity_merge_confirm', current.personId, mergeTarget))) {
                            void mutate('merge', { action: 'merge', sourceId: current.personId, targetId: mergeTarget })
                          }
                        }}
                      >
                        {busyAction === 'merge' ? t('video.identity_merging') : t('video.identity_merge_submit')}
                      </button>
                    </div>
                  </div>

                  <div className={styles.actionBlock}>
                    <div>
                      <h4>{t('video.identity_split_title')}</h4>
                      <p>
                        {selectedSegmentId != null && selectedTrackId != null
                          ? t('video.identity_split_desc', selectedSegmentId, selectedTrackId)
                          : t('video.identity_split_select_person')}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyAction !== null || selectedSegmentId == null || selectedTrackId == null}
                      onClick={async () => {
                        if (selectedSegmentId == null || selectedTrackId == null) return
                        if (await confirmAction(t('video.identity_split_confirm', selectedSegmentId, selectedTrackId))) {
                          void mutate('split', { action: 'split', segmentId: selectedSegmentId, trackId: selectedTrackId })
                        }
                      }}
                    >
                      {busyAction === 'split' ? t('video.identity_splitting') : t('video.identity_split_submit')}
                    </button>
                  </div>

                  {error && <p className={styles.error} role="alert">{error}</p>}
                  {success && <p className={styles.success} role="status">{success}</p>}
                </section>
              )}
            </div>
          )}
        </section>
      )}
    </>
  )
}
