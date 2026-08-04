'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { useConfirm } from '@/components/ui'
import { VideoBatchUploader } from '@/components/video-annotation/VideoBatchUploader'
import { VideoUploadDialog, type VideoUploadOutcome } from '@/components/video-annotation/VideoUploadDialog'
import { useLang } from '@/services/i18n'
import type { AnnotateSet, VideoTaskItem } from '@/services/video-annotation/types'
import { deriveQualityIssues, qualitySummary, type QualityIssueKind } from '@/services/video-annotation/quality-center'
import { deriveVideoReviewSummary } from '@/services/video-annotation/status'
import styles from './annotation-project.module.css'

const QUALITY_PAGE_SIZE = 12

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

function videoProgress(video: VideoTaskItem): { completed: number; total: number } {
  const segments = video.segments || []
  return {
    completed: segments.filter(segment => (
      segment.status === 'completed' || segment.status === 'partial_completed'
    )).length,
    total: segments.length,
  }
}

function VideoThumbnail({ video, eager = false }: { video: VideoTaskItem; eager?: boolean }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={styles.videoThumbnail}>
      {!failed ? (
        <Image
          src={`/api/video-annotation/files/${encodeURIComponent(video.videoId)}?t=0.1`}
          alt={`${video.fileName} thumbnail`}
          fill
          unoptimized
          sizes="132px"
          loading={eager ? 'eager' : 'lazy'}
          className={styles.videoThumbnailImage}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className={styles.videoThumbnailFallback}>
          <div>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        </div>
      )}
      {!failed && (
        <div className={styles.videoThumbnailOverlay}>
          <span className={styles.videoThumbnailPlay}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </div>
      )}
    </div>
  )
}

export default function VideoAnnotationProjectPage() {
  const { annotateId } = useParams<{ annotateId: string }>()
  const { t } = useLang()
  const confirmAction = useConfirm()
  const [project, setProject] = useState<AnnotateSet | null>(null)
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [activeUploadFile, setActiveUploadFile] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [qualityFilter, setQualityFilter] = useState<QualityIssueKind | 'all'>('all')
  const [qualityPage, setQualityPage] = useState(0)
  const [selectedQualityIssueId, setSelectedQualityIssueId] = useState<string | null>(null)

  const loadProject = useCallback(async () => {
    try {
      const response = await fetch(`/api/video-annotation/annotate-sets/${annotateId}`)
      if (response.ok) {
        const payload = await response.json() as { data: AnnotateSet }
        setProject(payload.data)
      } else {
        setProject(null)
      }
    } finally {
      setLoading(false)
    }
  }, [annotateId])

  useEffect(() => {
    void loadProject()
  }, [loadProject])

  const totals = useMemo(() => {
    const videos = project?.videos || []
    return {
      videos: videos.length,
      segments: videos.reduce((total, video) => total + (video.segments?.length || 0), 0),
    }
  }, [project])
  const qualityIssues = useMemo(() => project ? deriveQualityIssues(project) : [], [project])
  const quality = useMemo(() => qualitySummary(qualityIssues), [qualityIssues])
  const visibleQualityIssues = qualityFilter === 'all' ? qualityIssues : qualityIssues.filter(issue => issue.kind === qualityFilter)
  const qualityPageCount = Math.max(1, Math.ceil(visibleQualityIssues.length / QUALITY_PAGE_SIZE))
  const safeQualityPage = Math.min(qualityPage, qualityPageCount - 1)
  const pagedQualityIssues = visibleQualityIssues.slice(
    safeQualityPage * QUALITY_PAGE_SIZE,
    (safeQualityPage + 1) * QUALITY_PAGE_SIZE,
  )
  const selectedQualityIssue = visibleQualityIssues.find(issue => issue.id === selectedQualityIssueId)
    || pagedQualityIssues[0]
    || null

  const selectQualityFilter = (kind: QualityIssueKind | 'all') => {
    setQualityFilter(kind)
    setQualityPage(0)
    setSelectedQualityIssueId(null)
  }

  const openQualityPage = (page: number) => {
    const nextPage = Math.max(0, Math.min(page, qualityPageCount - 1))
    setQualityPage(nextPage)
    setSelectedQualityIssueId(visibleQualityIssues[nextPage * QUALITY_PAGE_SIZE]?.id || null)
  }

  const selectNextQualityIssue = () => {
    if (!selectedQualityIssue || visibleQualityIssues.length < 2) return
    const currentIndex = visibleQualityIssues.findIndex(issue => issue.id === selectedQualityIssue.id)
    const nextIndex = (currentIndex + 1) % visibleQualityIssues.length
    setSelectedQualityIssueId(visibleQualityIssues[nextIndex].id)
    setQualityPage(Math.floor(nextIndex / QUALITY_PAGE_SIZE))
  }

  const handleUpload = useCallback(async (files: File[]): Promise<VideoUploadOutcome> => {
    if (!project || files.length === 0 || uploading) {
      return { uploadedNames: [], failedNames: files.map(file => file.name), saved: false }
    }
    const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`
    setUploading(true)
    setUploadError('')
    setUploadProgress(Object.fromEntries(files.map(file => [fileKey(file), 0])))

    const uploadedVideos: VideoTaskItem[] = []
    const uploadedNames: string[] = []
    const failedNames: string[] = []
    for (const file of files) {
      setActiveUploadFile(file.name)
      try {
        const form = new FormData()
        form.append('file', file)
        const response = await fetch('/api/video-annotation/upload', { method: 'POST', body: form })
        if (!response.ok) throw new Error('upload failed')
        const { data } = await response.json()
        uploadedVideos.push({
          videoId: data.videoId,
          fileName: data.fileName,
          filePath: `uploads/${data.videoId}`,
          duration: data.duration || 0,
          fps: data.fps || 0,
          width: data.width || 0,
          height: data.height || 0,
          status: 'pending',
          segments: [],
          uploadProgress: 100,
        })
        uploadedNames.push(fileKey(file))
        setUploadProgress(current => ({ ...current, [fileKey(file)]: 100 }))
      } catch {
        failedNames.push(fileKey(file))
        setUploadProgress(current => ({ ...current, [fileKey(file)]: -1 }))
      }
    }

    let saved = uploadedVideos.length === 0
    try {
      if (uploadedVideos.length > 0) {
        const response = await fetch(`/api/video-annotation/annotate-sets/${annotateId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videos: [...(project.videos || []), ...uploadedVideos] }),
        })
        if (!response.ok) throw new Error('save failed')
        const payload = await response.json() as { data: AnnotateSet }
        setProject(payload.data)
        saved = true
      }
      if (failedNames.length > 0) setUploadError(t('video.upload_partial_failed'))
    } catch {
      saved = false
      if (uploadedVideos.length > 0) {
        setUploadError(t('video.upload_save_failed'))
      }
    } finally {
      setActiveUploadFile(null)
      setUploading(false)
    }
    return {
      uploadedNames,
      failedNames,
      saved,
    }
  }, [project, uploading, annotateId, t])

  const handleDeleteVideo = useCallback(async (video: VideoTaskItem) => {
    if (!project || deletingVideoId) return
    if (!await confirmAction({
      message: t('video.delete_video_confirm', video.fileName),
      confirmLabel: t('app.delete'),
      tone: 'danger',
    })) return

    setDeletingVideoId(video.videoId)
    setDeleteError('')
    try {
      const response = await fetch(
        `/api/video-annotation/annotate-sets/${encodeURIComponent(annotateId)}/videos/${encodeURIComponent(video.videoId)}`,
        { method: 'DELETE' },
      )
      const payload = await response.json() as {
        data?: AnnotateSet
        error?: { code?: string; message?: string }
      }
      if (!response.ok || !payload.data) {
        setDeleteError(payload.error?.code === 'VIDEO_BUSY'
          ? t('video.delete_video_busy')
          : t('video.delete_video_failed'))
        return
      }
      setProject(payload.data)
    } catch {
      setDeleteError(t('video.delete_video_failed'))
    } finally {
      setDeletingVideoId(null)
    }
  }, [project, deletingVideoId, annotateId, t, confirmAction])

  if (loading) {
    return (
      <div className={styles.pageRoot}>
        <WorkspaceHeader />
        <main className={styles.statePage} role="status" aria-live="polite">
          <span className={styles.stateSpinner} aria-hidden="true" />
          <p>{t('app.loading')}</p>
        </main>
      </div>
    )
  }

  if (!project) {
    return (
      <div className={styles.pageRoot}>
        <WorkspaceHeader />
        <main className={styles.statePage}>
          <span className={styles.stateIcon} aria-hidden="true">!</span>
          <h1>{t('video.project_not_found')}</h1>
          <Link href="/annotations" className={styles.secondaryAction}>{t('app.back')}</Link>
        </main>
      </div>
    )
  }

  return (
    <div className={styles.pageRoot}>
      <WorkspaceHeader />

      <main className={styles.page}>
        <header className={styles.projectCommandHeader}>
          <div className={styles.projectHeading}>
            <Link href="/annotations" className={styles.backLink} aria-label={t('video.back_to_projects')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="m15 18-6-6 6-6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <div>
              <h1>{project.name}</h1>
              <p>{t('video.project_summary', totals.videos, totals.segments)}</p>
            </div>
          </div>
          {(project.videos?.length || 0) > 0 && (
            <button
              onClick={() => {
                setUploadError('')
                setUploadProgress({})
                setActiveUploadFile(null)
                setShowUpload(true)
              }}
              disabled={uploading}
              className={styles.primaryAction}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M12 5v14M5 12h14" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              {t('video.add_videos')}
            </button>
          )}
        </header>

        <dl className={styles.operationalStrip} aria-label={t('video.project_overview')}>
          <div><dt>{t('video.videos')}</dt><dd>{totals.videos}</dd></div>
          <div><dt>{t('video.segments')}</dt><dd>{totals.segments}</dd></div>
          <div><dt>{t('video.quality_unreviewed')}</dt><dd>{quality.unreviewed}</dd></div>
          <div><dt>{t('video.quality_issues')}</dt><dd>{qualityIssues.length}</dd></div>
        </dl>

        {uploadError && (
          <div className={styles.errorNotice} role="alert">{uploadError}</div>
        )}

        {deleteError && (
          <div className={styles.errorNotice} role="alert">{deleteError}</div>
        )}

        {(project.videos?.length || 0) === 0 && !uploading ? (
          <section className={styles.emptyUpload}>
            <div className={styles.emptyUploadCopy}>
              <h2>{t('video.project_no_videos')}</h2>
              <p>{t('video.project_no_videos_desc')}</p>
            </div>
            <div className={styles.uploaderSurface}><VideoBatchUploader onFiles={files => { void handleUpload(files) }} /></div>
          </section>
        ) : (
          <section className={styles.projectWorkbench} aria-label={t('video.project_overview')}>
            <aside className={styles.qualityRail} aria-labelledby="quality-queue-title">
              <div className={styles.qualityRailHeader}>
                <div>
                  <h2 id="quality-queue-title">{t('video.quality_center')}</h2>
                  <p>{t('video.quality_center_desc')}</p>
                </div>
                <span>{visibleQualityIssues.length}</span>
              </div>
              <div className={styles.qualitySummary} aria-label={t('video.quality_center')}>
                <span className={styles.qualityCritical}>{quality.critical} {t('video.quality_critical')}</span>
                <span className={styles.qualityWarning}>{quality.warning} {t('video.quality_warning')}</span>
                <span>{quality.unreviewed} {t('video.quality_unreviewed')}</span>
              </div>
              <div className={styles.qualityFilters} role="group" aria-label={t('video.quality_center')}>
                {(['all', 'failed', 'degraded', 'unreviewed', 'unknown_fields', 'empty_entities', 'identity', 'recognition'] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={qualityFilter === kind}
                    onClick={() => selectQualityFilter(kind)}
                    className={qualityFilter === kind ? styles.qualityFilterActive : styles.qualityFilter}
                  >
                    {t(`video.quality_filter.${kind}`)}
                  </button>
                ))}
              </div>
              {selectedQualityIssue && (
                <section className={styles.qualityDetail} aria-live="polite" aria-label={t('video.quality_current_issue')}>
                  <header>
                    <div>
                      <span>{t(`video.quality_severity.${selectedQualityIssue.severity}`)}</span>
                      <h3>{t(`video.quality_issue.${selectedQualityIssue.kind}.title`)}</h3>
                    </div>
                    <strong>S{selectedQualityIssue.segmentId}</strong>
                  </header>
                  <dl>
                    <div><dt>{t('video.quality_issue_type')}</dt><dd>{t(`video.quality_filter.${selectedQualityIssue.kind}`)}</dd></div>
                    <div><dt>{t('video.quality_issue_object')}</dt><dd title={selectedQualityIssue.videoName}>{selectedQualityIssue.videoName}</dd></div>
                    <div><dt>{t('video.quality_issue_impact')}</dt><dd>{t(`video.quality_issue.${selectedQualityIssue.kind}.impact`)}</dd></div>
                  </dl>
                  <details>
                    <summary>{t('video.quality_raw_diagnosis')}</summary>
                    <p>{selectedQualityIssue.detail}</p>
                  </details>
                  <div className={styles.qualityDetailActions}>
                    <Link href={`/annotations/${annotateId}/videos/${selectedQualityIssue.videoId}?segment=${selectedQualityIssue.segmentId}`} className={styles.reviewIssueAction}>
                      {t('video.quality_review_current')}
                    </Link>
                    {visibleQualityIssues.length > 1 && (
                      <button type="button" onClick={selectNextQualityIssue}>{t('video.quality_next')}</button>
                    )}
                  </div>
                </section>
              )}
              <div className={styles.qualityList}>
                {visibleQualityIssues.length === 0 ? <p className={styles.qualityEmpty}>{t('video.quality_empty')}</p> : pagedQualityIssues.map(issue => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => setSelectedQualityIssueId(issue.id)}
                    aria-current={selectedQualityIssue?.id === issue.id ? 'true' : undefined}
                    className={styles.qualityIssue}
                  >
                    <span className={styles.issueHeading}>
                      <span className={`${styles.issueDot} ${issue.severity === 'critical' ? styles.issueCritical : issue.severity === 'warning' ? styles.issueWarning : styles.issueInfo}`} />
                      <strong>{t(`video.quality_issue.${issue.kind}.title`)}</strong>
                    </span>
                    <small title={issue.videoName}>{issue.videoName} · S{issue.segmentId}</small>
                    <span className={styles.issueImpact}>{t(`video.quality_issue.${issue.kind}.impact`)}</span>
                  </button>
                ))}
              </div>
              {visibleQualityIssues.length > QUALITY_PAGE_SIZE && (
                <nav className={styles.qualityPagination} aria-label={t('video.quality_pagination')}>
                  <span>{safeQualityPage * QUALITY_PAGE_SIZE + 1}–{Math.min((safeQualityPage + 1) * QUALITY_PAGE_SIZE, visibleQualityIssues.length)} / {visibleQualityIssues.length}</span>
                  <div>
                    <button type="button" onClick={() => openQualityPage(safeQualityPage - 1)} disabled={safeQualityPage === 0} aria-label={t('video.quality_previous_page')}>←</button>
                    <button type="button" onClick={() => openQualityPage(safeQualityPage + 1)} disabled={safeQualityPage >= qualityPageCount - 1} aria-label={t('video.quality_next_page')}>→</button>
                  </div>
                </nav>
              )}
            </aside>

            <section className={styles.videoWorkspace} aria-labelledby="video-workspace-title">
              <div className={styles.videoWorkspaceHeader}>
                <div>
                  <h2 id="video-workspace-title">{t('video.videos')}</h2>
                  <p>{t('video.project_overview_desc')}</p>
                </div>
                <span>{totals.videos}</span>
              </div>

              <div className={styles.videoWorkspaceScroll}>
                {uploading && !showUpload && (
                  <div className={styles.uploadProgress} role="status" aria-live="polite">
                    <div className={styles.uploadProgressHeader}>
                      <span className={styles.stateSpinner} aria-hidden="true" />
                      <p>{t('video.uploading_videos')}</p>
                    </div>
                    <div className={styles.uploadProgressList}>
                      {Object.entries(uploadProgress).map(([name, progress]) => (
                        <div key={name}>
                          <span>{name}</span>
                          <span className={progress < 0 ? styles.progressFailed : undefined}>
                            {progress < 0 ? t('video.upload_failed') : `${progress}%`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className={styles.videoList}>
                  {(project.videos || []).map((video, index) => {
                    const progress = videoProgress(video)
                    const progressPercent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
                    const review = deriveVideoReviewSummary(video)
                    return (
                      <article key={video.videoId} className={styles.videoRow}>
                        <Link href={`/annotations/${annotateId}/videos/${video.videoId}`} className={styles.videoLink}>
                          <VideoThumbnail video={video} eager={index === 0} />
                          <div className={styles.videoBody}>
                            <h3 title={video.fileName}>{video.fileName}</h3>
                            <p>{formatDuration(video.duration)} · {video.width || '--'}×{video.height || '--'} · {progress.total} {t('video.segments')}</p>
                          </div>
                          <div className={styles.videoProgressCell}>
                            <div><span>{progress.total > 0 ? t('video.video_progress', progress.completed, progress.total) : t('video.not_split')}</span><strong>{progressPercent}%</strong></div>
                            <span className={styles.videoProgressTrack} aria-hidden="true"><span style={{ width: `${progressPercent}%` }} /></span>
                            {review.total > 0 && (
                              <span className={styles.videoReviewStatus} data-status={review.status}>
                                {t(`video.review_value.${review.status}`)} · {t('video.review_progress', review.approved, review.total)}
                              </span>
                            )}
                          </div>
                          <span className={styles.videoOpen}>
                            {t('video.manage_video')}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                              <path d="m9 18 6-6-6-6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => { void handleDeleteVideo(video) }}
                          disabled={deletingVideoId !== null}
                          title={deletingVideoId === video.videoId ? t('video.deleting_video') : t('video.delete_video')}
                          aria-label={deletingVideoId === video.videoId ? t('video.deleting_video') : `${t('video.delete_video')}：${video.fileName}`}
                          className={styles.deleteVideo}
                        >
                          {deletingVideoId === video.videoId ? (
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
                            </svg>
                          )}
                        </button>
                      </article>
                    )
                  })}
                </div>
              </div>
            </section>
          </section>
        )}
      </main>

      {showUpload && (
        <VideoUploadDialog
          busy={uploading}
          progress={uploadProgress}
          activeFileName={activeUploadFile}
          error={uploadError}
          onClose={() => setShowUpload(false)}
          onUpload={handleUpload}
        />
      )}
    </div>
  )
}
