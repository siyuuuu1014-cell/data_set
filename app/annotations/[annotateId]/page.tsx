'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { VideoBatchUploader } from '@/components/video-annotation/VideoBatchUploader'
import { useLang } from '@/services/i18n'
import type { AnnotateSet, VideoTaskItem } from '@/services/video-annotation/types'

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

function VideoThumbnail({ video }: { video: VideoTaskItem }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-gv-pink/10 to-gv-green/10 border-b border-gv-border/50">
      {!failed ? (
        <Image
          src={`/api/video-annotation/files/${encodeURIComponent(video.videoId)}?t=0.1`}
          alt={`${video.fileName} thumbnail`}
          fill
          unoptimized
          sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-14 h-14 rounded-2xl bg-gv-surface/80 border border-gv-border/70 flex items-center justify-center">
            <svg className="w-7 h-7 text-gv-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        </div>
      )}
      {!failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 transition-colors">
          <span className="w-11 h-11 rounded-full bg-gv-surface/80 border border-white/50 shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <svg className="w-5 h-5 text-gv-pink translate-x-px" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
  const [project, setProject] = useState<AnnotateSet | null>(null)
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [uploadError, setUploadError] = useState('')

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

  const handleUpload = useCallback(async (files: File[]) => {
    if (!project || files.length === 0 || uploading) return
    setShowUpload(false)
    setUploading(true)
    setUploadError('')
    setUploadProgress(Object.fromEntries(files.map(file => [file.name, 0])))

    const uploadedVideos: VideoTaskItem[] = []
    for (const file of files) {
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
        setUploadProgress(current => ({ ...current, [file.name]: 100 }))
      } catch {
        setUploadProgress(current => ({ ...current, [file.name]: -1 }))
      }
    }

    if (uploadedVideos.length > 0) {
      const response = await fetch(`/api/video-annotation/annotate-sets/${annotateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos: [...(project.videos || []), ...uploadedVideos] }),
      })
      if (response.ok) {
        const payload = await response.json() as { data: AnnotateSet }
        setProject(payload.data)
      } else {
        setUploadError(t('video.upload_save_failed'))
      }
    }

    if (uploadedVideos.length !== files.length) setUploadError(t('video.upload_partial_failed'))
    setUploading(false)
  }, [project, uploading, annotateId, t])

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gv-text-dim">{t('app.loading')}</div>
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gv-text-dim">{t('video.project_not_found')}</p>
          <Link href="/annotations" className="text-sm text-gv-pink hover:underline mt-2 inline-block">{t('app.back')}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <WorkspaceHeader />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        <div className="mb-8">
          <Link href="/annotations" className="inline-flex items-center gap-1 text-sm text-gv-text-dim hover:text-gv-pink transition-colors mb-5">
            <span aria-hidden="true">←</span> {t('video.back_to_projects')}
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs uppercase tracking-[0.18em] text-gv-pink font-semibold">{t('video.project_label')}</span>
                <span className="h-px w-16 bg-gv-border/70" />
              </div>
              <h1 className="text-2xl font-bold text-gv-text">{project.name}</h1>
              <p className="text-sm text-gv-text-dim mt-1">
                {t('video.project_summary', totals.videos, totals.segments)}
              </p>
            </div>
            {(project.videos?.length || 0) > 0 && (
              <button onClick={() => setShowUpload(true)} disabled={uploading} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50">
                + {t('video.add_videos')}
              </button>
            )}
          </div>
        </div>

        {uploadError && (
          <div className="mb-5 rounded-lg border border-gv-pink/30 bg-gv-pink/5 px-4 py-3 text-sm text-gv-pink-dark">{uploadError}</div>
        )}

        {uploading && (
          <div className="card p-5 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="animate-spin w-5 h-5 border-2 border-gv-pink border-t-transparent rounded-full" />
              <p className="text-sm font-medium text-gv-text">{t('video.uploading_videos')}</p>
            </div>
            <div className="space-y-2">
              {Object.entries(uploadProgress).map(([name, progress]) => (
                <div key={name} className="flex items-center gap-3 text-xs text-gv-text-dim">
                  <span className="truncate flex-1">{name}</span>
                  <span className={progress < 0 ? 'text-gv-pink-dark' : 'text-gv-text-muted'}>
                    {progress < 0 ? t('video.upload_failed') : `${progress}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(project.videos?.length || 0) === 0 && !uploading ? (
          <div className="card p-6 sm:p-8">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-gv-text">{t('video.project_no_videos')}</h2>
              <p className="text-sm text-gv-text-dim mt-1">{t('video.project_no_videos_desc')}</p>
            </div>
            <VideoBatchUploader onFiles={files => { void handleUpload(files) }} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(project.videos || []).map((video, index) => {
              const progress = videoProgress(video)
              return (
                <Link
                  key={video.videoId}
                  href={`/annotations/${annotateId}/videos/${video.videoId}`}
                  className="card group overflow-hidden hover:border-gv-pink/40 hover:-translate-y-1 transition-all duration-300"
                  style={{ animation: `fade-in 0.4s ease-out ${index * 0.05}s both` }}
                >
                  <VideoThumbnail video={video} />
                  <div className="p-4">
                    <h2 className="font-semibold text-gv-text group-hover:text-gv-pink transition-colors truncate" title={video.fileName}>{video.fileName}</h2>
                    <p className="text-xs text-gv-text-dim mt-1.5">
                      {formatDuration(video.duration)} · {video.width || '--'}×{video.height || '--'}
                    </p>
                    <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-gv-border/50">
                      <span className="text-xs text-gv-text-muted">
                        {progress.total > 0
                          ? t('video.video_progress', progress.completed, progress.total)
                          : t('video.not_split')}
                      </span>
                      <span className="text-xs font-medium text-gv-pink">{t('video.manage_video')} →</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={() => setShowUpload(false)}>
          <div className="glass-raised rounded-xl w-full max-w-2xl mx-4 p-6" onClick={event => event.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gv-text mb-1">{t('video.upload_title')}</h2>
            <p className="text-sm text-gv-text-dim mb-5">{t('video.upload_desc')}</p>
            <VideoBatchUploader onFiles={files => { void handleUpload(files) }} />
            <div className="flex justify-end mt-5">
              <button onClick={() => setShowUpload(false)} className="btn-outline rounded-lg px-4 py-2 text-sm">{t('app.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
