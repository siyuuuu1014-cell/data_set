'use client'

import { useParams } from 'next/navigation'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useStore } from '@/services/store'
import Link from 'next/link'
import { VideoPlayer } from '@/components/video-annotation/VideoPlayer'
import { AnnotationCanvas } from '@/components/video-annotation/AnnotationCanvas'
import { TrackEditor } from '@/components/video-annotation/TrackEditor'
import { SceneCameraEditor } from '@/components/video-annotation/SceneCameraEditor'
import { JsonEditor } from '@/components/video-annotation/JsonEditor'
import { TextContent, type TextContentEdits } from '@/components/video-annotation/TextContent'
import { UndoToast, type UndoToastItem } from '@/components/video-annotation/UndoToast'
import { VideoBatchUploader } from '@/components/video-annotation/VideoBatchUploader'
import { ExportDialog } from '@/components/video-annotation/ExportDialog'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { useLang } from '@/services/i18n'
import {
  downloadAsFile,
  exportCurrentFrameJson,
  exportCustomJson,
  downloadYoloZip,
  exportCoco,
  generateVideoDescription,
  generateSemanticVideoDescription,
  type CustomJsonExportOptions,
} from '@/services/video-annotation/export-service'
import { visualEventsFor } from '@/services/video-annotation/visual-events'
import { isUntouchedDraftSegment, MIN_MANUAL_SEGMENT_DURATION } from '@/services/video-annotation/segment-split'
import {
  clampBox,
  convertEntityType,
  fillEmptyPersonAttributes,
  frameDisplayEntities,
  legacyFrame,
  nearestFrame,
  personDisplayId,
  renameObjectLabel,
  replaceObservation,
  trackRefKey,
  upsertFrame,
  type ObjectLabelRenameScope,
  type TrackRef,
} from '@/services/video-annotation/frame-annotations'
import type {
  AnnotateSet, BBox, ExportFormat,
  SegmentState, VideoTaskItem, VideoAnnotation, SegmentAnnotation,
  PersonAnnotation, ObjectAnnotation, SceneAnnotation, CameraAnnotation, EventAnnotation,
  AnnotationExecutionMode, FrameAnnotation, SpatialEntityType, PersonAnalysisResult
} from '@/services/video-annotation/types'

type PagePhase = 'no_videos' | 'uploading' | 'ready_uploaded' | 'detecting' | 'segments_pending' | 'annotating' | 'completed'

function deepClone<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)) as T }

function apiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

function formatSplitTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const minutes = Math.floor(safe / 60)
  return `${minutes}:${(safe % 60).toFixed(3).padStart(6, '0')}`
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

function hasRealData(human: SegmentAnnotation | null, model: SegmentAnnotation | null): boolean {
  if (!human) return false
  if (human._humanEdited) return true
  return (
    human.scene?.place?.type !== 'unknown' ||
    (human.persons || []).some(p => p.gender !== 'unknown' || (p.clothing || []).length > 0) ||
    human.camera?.angle !== 'unknown' ||
    (human.events || []).length > 0 ||
    Boolean(human.speechTranscript) ||
    (human.objects || []).some(o => !!(o.name && o.name !== 'unknown')) ||
    (human.persons || []).length > (model?.persons?.length || 0) ||
    (human.objects || []).length > (model?.objects?.length || 0)
  )
}

function getEffectiveAnnotation(seg: { humanAnnotation: SegmentAnnotation | null; modelAnnotation: SegmentAnnotation | null }): SegmentAnnotation | null {
  return hasRealData(seg.humanAnnotation, seg.modelAnnotation)
    ? seg.humanAnnotation
    : seg.modelAnnotation || null
}

function defaultScene(): SceneAnnotation {
  return { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } }
}

function defaultCamera(): CameraAnnotation {
  return { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' }
}

function editingFrameFor(
  annotation: SegmentAnnotation,
  segment: SegmentState,
  video: VideoTaskItem,
  requestedFrameIndex: number | null,
): FrameAnnotation {
  const frames = annotation.frames || []
  const exact = requestedFrameIndex == null
    ? null
    : frames.find(frame => frame.frameIndex === requestedFrameIndex) || null
  if (exact) return exact
  if (frames.length) return frames[0]
  const timestamp = segment.start + Math.max(0, segment.end - segment.start) / 2
  return legacyFrame(
    annotation,
    timestamp,
    video.fps || 30,
    video.width || 1920,
    video.height || 1080,
  )
}

function TrackReviewEditor({
  annotation,
  selectedTrackId,
  selectedEntityType,
  selectedFrameIndex,
  selectedFrameLabel,
  selectedSourceLabels,
  onAnalyzePerson,
  onDelete,
  onSave,
  onConvert,
}: {
  annotation: SegmentAnnotation
  selectedTrackId: number
  selectedEntityType: SpatialEntityType
  selectedFrameIndex: number
  selectedFrameLabel?: string
  selectedSourceLabels: string[]
  onAnalyzePerson: (trackId: number, frameIndex: number) => Promise<PersonAnalysisResult>
  onDelete: (trackId: number, entityType: SpatialEntityType) => void
  onSave: (updated: PersonAnnotation | ObjectAnnotation, scope: ObjectLabelRenameScope, sourceLabels?: string[], frameIndex?: number) => void
  onConvert: (scope: 'frame' | 'track', targetType: SpatialEntityType, objectLabel?: string) => void
}) {
  const summary = selectedEntityType === 'person'
    ? annotation.persons?.find(item => item.trackId === selectedTrackId)
    : annotation.objects?.find(item => item.trackId === selectedTrackId)
  const selected = summary && selectedEntityType === 'object' && selectedFrameLabel
    ? { ...summary, name: selectedFrameLabel }
    : summary
  const [edits, setEdits] = useState<PersonAnnotation | ObjectAnnotation | null>(
    () => selected ? deepClone(selected) : null,
  )
  const [dirty, setDirty] = useState(false)
  const [conversionLabel, setConversionLabel] = useState('')
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'running' | 'ready' | 'failed'>('idle')
  const [analysisResult, setAnalysisResult] = useState<PersonAnalysisResult | null>(null)
  const [analysisError, setAnalysisError] = useState('')

  if (!edits) return null

  return (
    <div className="mb-4 p-3 rounded-lg border border-gv-border bg-gv-surface">
      <h4 className="text-sm font-semibold text-gv-text mb-2 flex items-center justify-between">
        <span>
          {'gender' in edits
            ? `Person ${personDisplayId((edits as PersonAnnotation).personId, selectedTrackId)}`
            : `Object Track ${selectedTrackId}`}
          {'gender' in edits && (
            <span className="ml-2 text-xs text-gv-text-muted font-normal">
              (segment Track {selectedTrackId})
            </span>
          )}
          {('_className' in edits) && (
            <span className="ml-2 text-xs text-gv-text-muted font-normal">
              ({edits._className})
            </span>
          )}
        </span>
        <button
          onClick={() => onDelete(selectedTrackId, selectedEntityType)}
          className="text-xs text-gv-pink-dark hover:text-gv-pink px-2 py-0.5 rounded hover:bg-gv-pink/10 transition-colors"
          title="Delete track (Delete key)"
        >
          Delete
        </button>
      </h4>
      <TrackEditor
        person={'gender' in edits ? edits as PersonAnnotation : null}
        object={!('gender' in edits) ? edits as ObjectAnnotation : null}
        onChange={updated => { setEdits(updated); setDirty(true) }}
        onSave={scope => { onSave(edits, scope, selectedSourceLabels, selectedFrameIndex); setDirty(false) }}
        dirty={dirty}
        detectionConfidence={(edits as unknown as Record<string, unknown>)._detectionConfidence as number | undefined}
        frameLabel={selectedFrameLabel}
      />
      {'gender' in edits && (
        <div className="mt-3 rounded-lg border border-gv-border/60 bg-gv-bg/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={analysisStatus === 'running'}
              onClick={() => {
                setAnalysisStatus('running')
                setAnalysisError('')
                setAnalysisResult(null)
                void onAnalyzePerson(selectedTrackId, selectedFrameIndex).then(result => {
                  setAnalysisResult(result)
                  setAnalysisStatus('ready')
                }).catch(error => {
                  setAnalysisError(error instanceof Error ? error.message : String(error))
                  setAnalysisStatus('failed')
                })
              }}
              className="rounded bg-gv-pink/10 px-3 py-1.5 text-xs font-medium text-gv-pink hover:bg-gv-pink/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analysisStatus === 'running' ? 'Analyzing Selected Person…' : 'Analyze Selected Person'}
            </button>
            <span className="text-xs text-gv-text-muted">
              Preview only; existing reviewed values are never overwritten.
            </span>
          </div>
          {analysisResult && (
            <div className="mt-3 space-y-2 text-xs">
              <p className="text-gv-text-muted">
                Suggested by {analysisResult.source === 'remote_api' ? 'Remote API' : 'Local Qwen'} at {analysisResult.timestamp.toFixed(3)}s
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gv-surface p-2 text-gv-text">
                {JSON.stringify(analysisResult.person, null, 2)}
              </pre>
              <button
                type="button"
                onClick={() => {
                  setEdits(fillEmptyPersonAttributes(edits as PersonAnnotation, analysisResult.person))
                  setDirty(true)
                }}
                className="rounded bg-gv-green/20 px-3 py-1.5 font-medium text-gv-green-deep hover:bg-gv-green/30"
              >
                Fill Empty Fields (Not Saved Yet)
              </button>
              <p className="text-gv-gold-dark">Review the fields, then click Save Changes.</p>
            </div>
          )}
          {analysisError && <p className="mt-2 text-xs text-gv-pink">{analysisError}</p>}
        </div>
      )}
      <div className="mt-3 border-t border-gv-border/60 pt-3">
        <p className="mb-2 text-xs font-medium text-gv-text">
          Wrong type? Convert {selectedEntityType === 'person' ? 'Person → Object' : 'Object → Person'}
        </p>
        {selectedEntityType === 'person' && (
          <input
            value={conversionLabel}
            onChange={event => setConversionLabel(event.target.value)}
            placeholder="Required object label"
            className="mb-2 w-full rounded border border-gv-border bg-gv-bg px-2 py-1.5 text-xs text-gv-text"
          />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={selectedEntityType === 'person' && !conversionLabel.trim()}
            onClick={() => onConvert('frame', selectedEntityType === 'person' ? 'object' : 'person', conversionLabel)}
            className="rounded bg-gv-green/20 px-2 py-1 text-xs text-gv-green-deep hover:bg-gv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Convert This Frame
          </button>
          <button
            type="button"
            disabled={selectedEntityType === 'person' && !conversionLabel.trim()}
            onClick={() => {
              if (confirm(`Convert this ${selectedEntityType} track across all annotated segments in the video?`)) {
                onConvert('track', selectedEntityType === 'person' ? 'object' : 'person', conversionLabel)
              }
            }}
            className="rounded bg-gv-gold/15 px-2 py-1 text-xs text-gv-gold-dark hover:bg-gv-gold/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Convert Entire Track
          </button>
        </div>
      </div>
    </div>
  )
}

function SegmentReviewEditor({
  annotation,
  onSave,
}: {
  annotation: SegmentAnnotation
  onSave: (scene: SceneAnnotation, camera: CameraAnnotation, events: EventAnnotation[]) => void
}) {
  const [scene, setScene] = useState<SceneAnnotation>(() => deepClone(annotation.scene || defaultScene()))
  const [camera, setCamera] = useState<CameraAnnotation>(() => deepClone(annotation.camera || defaultCamera()))
  const [events, setEvents] = useState<EventAnnotation[]>(() => deepClone(visualEventsFor(annotation)))
  const [dirty, setDirty] = useState(false)

  return (
    <div className="mb-4 p-3 rounded-lg border border-gv-border bg-gv-surface">
      <h4 className="text-sm font-semibold text-gv-text mb-2">Scene &amp; Camera</h4>
      <SceneCameraEditor
        scene={scene}
        camera={camera}
        events={events}
        onChange={update => {
          if (update.scene) setScene(update.scene)
          if (update.camera) setCamera(update.camera)
          if (update.events !== undefined) setEvents(update.events)
          setDirty(true)
        }}
        onSave={() => { onSave(scene, camera, events); setDirty(false) }}
        dirty={dirty}
      />
    </div>
  )
}

export default function AnnotateDetailPage() {
  const { t, lang } = useLang()
  const { id: routeProjectId, annotateId, videoId: routeVideoId } = useParams<{ id?: string; annotateId: string; videoId?: string }>()
  const { updateAnnotateSet } = useStore()

  const [set, setSet] = useState<AnnotateSet | null>(null)
  const id = routeProjectId || set?.projectId || ''
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [viewMode, setViewMode] = useState<'completed' | null>(null)
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null)
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null)

  const requestSet = useCallback(async (): Promise<AnnotateSet | null> => {
    try {
      const res = await fetch(`/api/video-annotation/annotate-sets/${annotateId}`)
      if (res.ok) {
        const { data } = await res.json()
        return data as AnnotateSet
      }
    } catch {}
    return null
  }, [annotateId])

  const fetchSet = useCallback(async () => {
    const data = await requestSet()
    if (data) setSet(data)
    setLoading(false)
  }, [requestSet])

  useEffect(() => {
    let active = true
    void requestSet().then(data => {
      if (!active) return
      if (data) {
        setSet(data)
        const videos = routeVideoId
          ? (data.videos || []).filter(video => video.videoId === routeVideoId)
          : (data.videos || [])
        const firstVideo = videos[0]
        setSelectedVideoId(firstVideo?.videoId || null)
        setSelectedSegmentId(firstVideo?.segments?.[0]?.segmentId ?? null)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [requestSet, routeVideoId])
  useEffect(() => { if (!set || !id) return; updateAnnotateSet(id, annotateId, set) }, [set, id, annotateId, updateAnnotateSet])

  const [transition, setTransition] = useState<'uploading' | 'detecting' | 'annotating' | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [canvasMode, setCanvasMode] = useState<'view' | 'draw'>('view')
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [selectedEntityType, setSelectedEntityType] = useState<SpatialEntityType | null>(null)
  const [drawEntityType, setDrawEntityType] = useState<SpatialEntityType | null>(null)
  const [drawObjectName, setDrawObjectName] = useState('')
  const [spatialSaveStatus, setSpatialSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const spatialSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const spatialSaveRevisionRef = useRef(0)
  const [workerStatus, setWorkerStatus] = useState<string>('checking')
  const [showExport, setShowExport] = useState(false)
  const [showSegmentExport, setShowSegmentExport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [annotatingSegments, setAnnotatingSegments] = useState<Set<string>>(new Set())
  const [selectedFailedSegments, setSelectedFailedSegments] = useState<Set<string>>(new Set())
  const [retryingSelected, setRetryingSelected] = useState(false)
  const [sceneThreshold, setSceneThreshold] = useState(0.4)
  const sceneThresholdRef = useRef(sceneThreshold)
  useEffect(() => { sceneThresholdRef.current = sceneThreshold }, [sceneThreshold])
  const [manualSplitMode, setManualSplitMode] = useState(false)
  const [manualSplitTime, setManualSplitTime] = useState<number | null>(null)
  const [manualSplitSaving, setManualSplitSaving] = useState(false)
  const [manualSplitError, setManualSplitError] = useState<string | null>(null)
  const handleSplitCursorSeek = useCallback((time: number) => {
    if (Number.isFinite(time)) setManualSplitTime(time)
  }, [])

  // ── Undo / pending delete ─────────────────────────
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set())
  const commitTimersRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; videoId: string; segmentId: number; frameIndex: number; ref: TrackRef }>>(new Map())
  const toastCounterRef = useRef(0)
  const [toasts, setToasts] = useState<UndoToastItem[]>([])
  // Refs for stale-closure safety in timers
  const setRef = useRef(set)
  useEffect(() => { setRef.current = set }, [set])

  const scopedVideos = useMemo(() => {
    const videos = set?.videos || []
    return routeVideoId ? videos.filter(video => video.videoId === routeVideoId) : videos
  }, [set, routeVideoId])

  const phase: PagePhase = useMemo(() => {
    if (transition === 'uploading') return 'uploading'
    if (transition === 'detecting') return 'detecting'
    if (!set) return transition || 'no_videos'
    const vids = scopedVideos
    if (vids.length === 0) return 'no_videos'
    const hasSegments = vids.some(v => (v.segments || []).length > 0)
    const allDone = vids.every(v => (v.segments || []).every(s => (
      s.status === 'completed' || s.status === 'partial_completed' || s.status === 'failed'
    )))
    const someDone = vids.some(v => (v.segments || []).some(s => (
      s.status === 'completed' || s.status === 'partial_completed'
    )))
    const isAnnotating = vids.some(v => (v.segments || []).some(s => s.status === 'processing'))
    if (isAnnotating) return 'annotating'
    if (viewMode === 'completed') return 'completed'
    if (allDone || someDone) return 'segments_pending'
    if (hasSegments) return 'segments_pending'
    return 'ready_uploaded'
  }, [set, scopedVideos, transition, viewMode])

  useEffect(() => {
    fetch('/api/video-annotation/worker/health')
      .then(r => r.json())
      .then(d => setWorkerStatus(d.status === 'ok' ? 'ok' : 'unavailable'))
      .catch(() => setWorkerStatus('unavailable'))
  }, [])

  // ── Handlers ───────────────────────────────────────

  const handleUpload = useCallback(async (files: File[]) => {
    if (!set) return
    setTransition('uploading')
    setUploadProgress({})
    for (const file of files) setUploadProgress(prev => ({ ...prev, [file.name]: 0 }))
    const uploadedVideos: VideoTaskItem[] = []
    for (const file of files) {
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/video-annotation/upload', { method: 'POST', body: form })
        if (res.ok) {
          const { data } = await res.json()
          uploadedVideos.push({
            videoId: data.videoId, fileName: data.fileName, filePath: `uploads/${data.videoId}`,
            duration: data.duration || 0, fps: data.fps || 0, width: data.width || 0, height: data.height || 0,
            status: 'pending' as const, segments: [], uploadProgress: 100,
          })
          setUploadProgress(prev => ({ ...prev, [file.name]: 100 }))
        }
      } catch { setUploadProgress(prev => ({ ...prev, [file.name]: -1 })) }
    }
    if (uploadedVideos.length > 0) {
      await fetch(`/api/video-annotation/annotate-sets/${annotateId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos: [...(set.videos || []), ...uploadedVideos] }),
      })
      await fetchSet()
    }
    setTransition(null)
  }, [set, annotateId, fetchSet])

  const handleDetectScenes = useCallback(async (videoId: string) => {
    if (!set) return
    setTransition('detecting')
    try {
      const res = await fetch('/api/video-annotation/segments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotateSetId: annotateId, videoId, sceneThreshold: sceneThresholdRef.current }),
      })
      if (res.ok) await fetchSet()
    } catch {}
    setTransition(null)
  }, [set, annotateId, fetchSet])

  const handleAnnotateSegment = useCallback(async (
    videoId: string,
    seg: SegmentState,
    mode: AnnotationExecutionMode = 'standard',
  ) => {
    if (!set) return
    const key = `${videoId}_${seg.segmentId}`
    let submitted = false
    setViewMode(null)
    setAnnotatingSegments(prev => new Set(prev).add(key))
    try {
      const res = await fetch(`/api/video-annotation/segments/${seg.segmentId}/annotate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annotateSetId: annotateId,
          videoId,
          start: seg.start,
          end: seg.end,
          mode,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(apiErrorMessage(err, `Annotation failed (HTTP ${res.status})`))
        return
      }
      submitted = true
      setTimeout(() => {
        void fetchSet().finally(() => {
          setAnnotatingSegments(prev => { const next = new Set(prev); next.delete(key); return next })
        })
      }, 1000)
    } catch (e) {
      alert(`Cannot reach server: ${String(e)}`)
    } finally {
      if (!submitted) {
        setAnnotatingSegments(prev => { const next = new Set(prev); next.delete(key); return next })
      }
    }
  }, [set, annotateId, fetchSet])

  const handleAnnotateAll = useCallback(async () => {
    if (!set) return
    for (const vid of scopedVideos)
      for (const seg of vid.segments || [])
        await handleAnnotateSegment(vid.videoId, seg)
  }, [set, scopedVideos, handleAnnotateSegment])

  const handleRetrySelectedFailed = useCallback(async () => {
    if (!set || retryingSelected) return
    const selected: Array<{ videoId: string; segment: SegmentState }> = []
    for (const video of scopedVideos) {
      for (const segment of video.segments || []) {
        const key = `${video.videoId}_${segment.segmentId}`
        if (
          (segment.status === 'failed' || segment.status === 'partial_completed')
          && selectedFailedSegments.has(key)
        ) {
          selected.push({ videoId: video.videoId, segment })
        }
      }
    }
    if (selected.length === 0) return

    setRetryingSelected(true)
    try {
      for (const item of selected) {
        await handleAnnotateSegment(item.videoId, item.segment)
      }
      setSelectedFailedSegments(new Set())
      await fetchSet()
    } finally {
      setRetryingSelected(false)
    }
  }, [set, scopedVideos, selectedFailedSegments, retryingSelected, handleAnnotateSegment, fetchSet])

  const handleExport = useCallback(async (format: ExportFormat, options: CustomJsonExportOptions) => {
    if (!set || exporting) return
    setExporting(true)
    try {
      const annotations: VideoAnnotation[] = []
      for (const vid of scopedVideos) {
        const segAnnotations: SegmentAnnotation[] = []
        for (const seg of vid.segments || []) {
          const ann = getEffectiveAnnotation(seg)
          if (ann) segAnnotations.push({ ...ann, segmentId: seg.segmentId, start: seg.start, end: seg.end })
        }
        if (segAnnotations.length > 0 || vid.duration > 0) {
          annotations.push({
            video: { videoId: vid.videoId, filePath: vid.filePath || vid.fileName, duration: vid.duration, fps: vid.fps, width: vid.width, height: vid.height, description: generateVideoDescription(segAnnotations) },
            annotations: segAnnotations,
          })
        }
      }

      if (format === 'json') {
        const summaries = []
        for (const annotation of annotations) {
          summaries.push(await generateSemanticVideoDescription(annotation.annotations, lang))
        }
        summaries.forEach((summary, index) => {
          annotations[index].video.description = summary.description
        })
        await downloadAsFile(exportCustomJson(annotations, options), `${set.name}_annotations.json`)
        if (summaries.some(summary => summary.source === 'fallback')) {
          alert(t('video.export_summary_fallback'))
        }
      } else if (format === 'yolo') {
        await downloadYoloZip(annotations, `${set.name}_yolo_labels.zip`)
      } else if (format === 'coco') {
        await downloadAsFile(exportCoco(annotations), `${set.name}_coco.json`)
      }
      setShowExport(false)
    } catch (error) {
      console.error('[video export] export failed', error)
      alert(t('video.export_failed'))
    } finally {
      setExporting(false)
    }
  }, [set, scopedVideos, exporting, lang, t])

  const handleExportCurrentSegment = useCallback(async (options: CustomJsonExportOptions) => {
    if (!set || !selectedVideoId || selectedSegmentId == null || exporting) return
    const video = (set.videos || []).find(item => item.videoId === selectedVideoId)
    const segment = video?.segments?.find(item => item.segmentId === selectedSegmentId)
    if (!video || !segment) return

    const annotation = getEffectiveAnnotation(segment)
    if (!annotation) {
      alert(t('video.export_segment_unavailable'))
      return
    }

    setExporting(true)
    try {
      const allSegmentAnnotations = (video.segments || []).flatMap(item => {
        const effective = getEffectiveAnnotation(item)
        return effective ? [{ ...effective, segmentId: item.segmentId, start: item.start, end: item.end }] : []
      })
      const currentAnnotation = {
        ...annotation,
        segmentId: segment.segmentId,
        start: segment.start,
        end: segment.end,
      }
      const summary = await generateSemanticVideoDescription(allSegmentAnnotations, lang)
      const singleSegmentExport: VideoAnnotation[] = [{
        video: {
          videoId: video.videoId,
          filePath: video.filePath || video.fileName,
          duration: video.duration,
          fps: video.fps,
          width: video.width,
          height: video.height,
          description: summary.description,
        },
        annotations: [currentAnnotation],
      }]
      await downloadAsFile(
        exportCustomJson(singleSegmentExport, options),
        `${video.videoId}_segment_${segment.segmentId}.json`,
      )
      if (summary.source === 'fallback') alert(t('video.export_summary_fallback'))
      setShowSegmentExport(false)
    } catch (error) {
      console.error('[video export] current segment export failed', error)
      alert(t('video.export_failed'))
    } finally {
      setExporting(false)
    }
  }, [set, selectedVideoId, selectedSegmentId, exporting, lang, t])

  const persistAnnotationUpdates = useCallback((
    nextSet: AnnotateSet,
    videoId: string,
    updates: Array<{ segmentId: number; annotation: SegmentAnnotation }>,
  ) => {
    setRef.current = nextSet
    setSet(nextSet)
    updateAnnotateSet(id, annotateId, nextSet)
    setSpatialSaveStatus('saving')
    const revision = ++spatialSaveRevisionRef.current
    spatialSaveQueueRef.current = spatialSaveQueueRef.current.catch(() => {}).then(async () => {
      const response = await fetch(`/api/video-annotation/annotate-sets/${annotateId}/frames`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, updates }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (revision === spatialSaveRevisionRef.current) setSpatialSaveStatus('saved')
    }).catch(error => {
      console.error('[frame annotation] save failed', error)
      if (revision === spatialSaveRevisionRef.current) setSpatialSaveStatus('failed')
    })
  }, [id, annotateId, updateAnnotateSet])

  const persistSegmentAnnotation = useCallback((nextSet: AnnotateSet, videoId: string, segmentId: number, annotation: SegmentAnnotation) => {
    persistAnnotationUpdates(nextSet, videoId, [{ segmentId, annotation }])
  }, [persistAnnotationUpdates])

  const handleCanvasModeChange = useCallback((mode: 'view' | 'draw') => {
    setCanvasMode(mode)
    if (mode === 'draw') {
      // Do not silently reuse Person from a previous operation. Every new box
      // requires an explicit entity choice.
      setDrawEntityType(null)
      setDrawObjectName('')
      setSelectedTrackId(null)
      setSelectedEntityType(null)
    }
  }, [])

  const handleDrawBox = useCallback((box: BBox, imageWidth: number, imageHeight: number) => {
    const currentSet = setRef.current
    if (!currentSet || !selectedVideoId || selectedSegmentId == null || !drawEntityType) return
    const video = currentSet.videos.find(item => item.videoId === selectedVideoId)
    const segment = video?.segments.find(item => item.segmentId === selectedSegmentId)
    const source = segment ? getEffectiveAnnotation(segment) : null
    if (!video || !segment || !source) return
    const frame = editingFrameFor(source, segment, video, selectedFrameIndex)
    const normalizedBox = clampBox(box, imageWidth, imageHeight)
    const className = drawEntityType === 'person' ? 'person' : drawObjectName.trim()
    if (!className) return
    const entityType = drawEntityType
    const videoId = selectedVideoId
    const segmentId = selectedSegmentId
    setSelectedTrackId(null)
    setSelectedEntityType(null)
    setCanvasMode('view')
    setSpatialSaveStatus('saving')
    const revision = ++spatialSaveRevisionRef.current
    spatialSaveQueueRef.current = spatialSaveQueueRef.current.catch(() => {}).then(async () => {
      const response = await fetch(`/api/video-annotation/annotate-sets/${annotateId}/frames/manual-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          segmentId,
          frameIndex: frame.frameIndex,
          timestamp: frame.timestamp,
          imageWidth,
          imageHeight,
          entityType,
          className,
          bbox: normalizedBox,
        }),
      })
      const payload = await response.json().catch(() => null) as {
        data?: AnnotateSet
        manualTrack?: { trackId?: number; personId?: string | null }
      } | null
      if (!response.ok || !payload?.data || !Number.isSafeInteger(payload.manualTrack?.trackId)) {
        throw new Error(apiErrorMessage(payload, `HTTP ${response.status}`))
      }
      const trackId = payload.manualTrack!.trackId!
      setRef.current = payload.data
      setSet(payload.data)
      updateAnnotateSet(id, annotateId, payload.data)
      setSelectedFrameIndex(frame.frameIndex)
      setSelectedTrackId(trackId)
      setSelectedEntityType(entityType)
      if (revision === spatialSaveRevisionRef.current) setSpatialSaveStatus('saved')
    }).catch(error => {
      console.error('[manual track] save failed', error)
      if (revision === spatialSaveRevisionRef.current) setSpatialSaveStatus('failed')
    })
  }, [
    id, annotateId, updateAnnotateSet, selectedVideoId, selectedSegmentId,
    selectedFrameIndex, drawEntityType, drawObjectName,
  ])

  const handleResizeBox = useCallback((trackId: number, entityType: SpatialEntityType, newBox: BBox, imageWidth: number, imageHeight: number) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const newSet: AnnotateSet = {
      ...set,
      videos: (set.videos || []).map(v => {
        if (v.videoId !== selectedVideoId) return v
        return { ...v, segments: (v.segments || []).map(s => {
          if (s.segmentId !== selectedSegmentId) return s
          const origAnn = getEffectiveAnnotation(s)
          if (!origAnn) return s
          let ann = deepClone(origAnn)
          const frame = editingFrameFor(ann, s, v, selectedFrameIndex)
          const bounded = clampBox(newBox, imageWidth, imageHeight)
          ann = upsertFrame(ann, replaceObservation({ ...frame, imageWidth, imageHeight }, { trackId, entityType }, observation => ({ ...observation, bbox: bounded })))
          if (entityType === 'person') ann.persons = ann.persons.map(p => p.trackId === trackId ? { ...p, bbox: bounded } : p)
          else ann.objects = ann.objects.map(o => o.trackId === trackId ? { ...o, bbox: bounded } : o)
          return { ...s, humanAnnotation: ann }
        })}
      }),
    }
    const annotation = getEffectiveAnnotation(newSet.videos.find(item => item.videoId === selectedVideoId)?.segments.find(item => item.segmentId === selectedSegmentId) || { humanAnnotation: null, modelAnnotation: null })
    if (annotation) persistSegmentAnnotation(newSet, selectedVideoId, selectedSegmentId, annotation)
  }, [set, selectedVideoId, selectedSegmentId, selectedFrameIndex, persistSegmentAnnotation])

  const commitPendingDeleteRef = useRef<((itemKey: string) => void) | null>(null)

  const handleDeleteTrack = useCallback((trackId: number, entityType: SpatialEntityType) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const video = set.videos.find(item => item.videoId === selectedVideoId)
    const segment = video?.segments.find(item => item.segmentId === selectedSegmentId)
    const annotation = segment ? getEffectiveAnnotation(segment) : null
    if (!video || !segment || !annotation) return
    const frame = editingFrameFor(annotation, segment, video, selectedFrameIndex)
    const ref = { trackId, entityType }
    const itemKey = `${selectedVideoId}:${selectedSegmentId}:${frame.frameIndex}:${trackRefKey(ref)}`

    // Mark as pending — visually hidden but recoverable
    setPendingDeletes(prev => new Set(prev).add(itemKey))
    setSelectedTrackId(null)
    setSelectedEntityType(null)

    // Schedule commit after 6s — uses ref to avoid stale closure
    const timer = setTimeout(() => {
      commitPendingDeleteRef.current?.(itemKey)
    }, 6000)
    commitTimersRef.current.set(itemKey, { timer, videoId: selectedVideoId, segmentId: selectedSegmentId, frameIndex: frame.frameIndex, ref })

    // Show undo toast
    const toastId = ++toastCounterRef.current
    setToasts(prev => [...prev, { id: toastId, itemKey, message: `Deleted ${entityType} #${trackId} from this frame` }])
  }, [set, selectedVideoId, selectedSegmentId, selectedFrameIndex])

  // commitPendingDelete: actually filters the track and persists
  const commitPendingDelete = useCallback((itemKey: string) => {
    // Read videoId/segmentId before removing from map
    const entry = commitTimersRef.current.get(itemKey)
    const vidId = entry?.videoId
    const segId = entry?.segmentId
    commitTimersRef.current.delete(itemKey)
    setPendingDeletes(prev => {
      const next = new Set(prev)
      next.delete(itemKey)
      return next
    })
    setToasts(prev => prev.filter(t => t.itemKey !== itemKey))

    const curSet = setRef.current
    if (!curSet || !entry || !vidId || segId == null) return
    const newSet: AnnotateSet = {
      ...curSet,
      videos: (curSet.videos || []).map(v => {
        if (v.videoId !== vidId) return v
        return { ...v, segments: (v.segments || []).map(s => {
          if (s.segmentId !== segId) return s
          const sourceAnnotation = getEffectiveAnnotation(s)
          if (!sourceAnnotation) return s
          let ann = deepClone(sourceAnnotation)
          const frame = editingFrameFor(ann, s, v, entry.frameIndex)
          ann = upsertFrame(ann, replaceObservation(frame, entry.ref, () => null))
          const stillObserved = (ann.frames || []).some(item => item.observations.some(observation => (
            observation.trackId === entry.ref.trackId && observation.entityType === entry.ref.entityType
          )))
          if (!stillObserved && entry.ref.entityType === 'person') ann.persons = ann.persons.filter(p => p.trackId !== entry.ref.trackId)
          if (!stillObserved && entry.ref.entityType === 'object') ann.objects = ann.objects.filter(o => o.trackId !== entry.ref.trackId)
          return { ...s, humanAnnotation: { ...ann } }
        })}
      }),
    }
    const annotation = getEffectiveAnnotation(newSet.videos.find(item => item.videoId === vidId)?.segments.find(item => item.segmentId === segId) || { humanAnnotation: null, modelAnnotation: null })
    if (annotation) persistSegmentAnnotation(newSet, vidId, segId, annotation)
  }, [persistSegmentAnnotation])

  useEffect(() => { commitPendingDeleteRef.current = commitPendingDelete }, [commitPendingDelete])

  const undoDeleteTrack = useCallback((itemKey: string) => {
    // Cancel the pending commit
    const entry = commitTimersRef.current.get(itemKey)
    if (entry) {
      clearTimeout(entry.timer)
      commitTimersRef.current.delete(itemKey)
    }
    setPendingDeletes(prev => {
      const next = new Set(prev)
      next.delete(itemKey)
      return next
    })
    setToasts(prev => prev.filter(t => t.itemKey !== itemKey))
    if (entry) {
      setSelectedTrackId(entry.ref.trackId)
      setSelectedEntityType(entry.ref.entityType)
    }
  }, [])

  // Flush all pending deletes when switching segments
  const flushPendingDeletes = useCallback(() => {
    const itemKeys = [...pendingDeletes]
    if (itemKeys.length === 0) return
    for (const itemKey of itemKeys) {
      const entry = commitTimersRef.current.get(itemKey)
      if (entry) clearTimeout(entry.timer)
      commitPendingDelete(itemKey)
    }
  }, [pendingDeletes, commitPendingDelete])

  const handleDeleteSegment = useCallback((segVideoId: string, segSegmentId: number) => {
    if (!set) return
    if (!confirm(`Delete segment ${segSegmentId}?`)) return
    const newSet: AnnotateSet = {
      ...set,
      videos: (set.videos || []).map(v => {
        if (v.videoId !== segVideoId) return v
        return { ...v, segments: (v.segments || []).filter(s => s.segmentId !== segSegmentId) }
      }),
    }
    setSet(newSet)
    if (selectedVideoId === segVideoId && selectedSegmentId === segSegmentId) {
      const remaining = newSet.videos
        .find(video => video.videoId === segVideoId)
        ?.segments || []
      setSelectedSegmentId(remaining[0]?.segmentId ?? null)
      setSelectedTrackId(null)
    }
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

  const handleSaveSegEdits = useCallback((
    scene: SceneAnnotation,
    camera: CameraAnnotation,
    events: EventAnnotation[],
  ) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const segment = set.videos.find(v => v.videoId === selectedVideoId)?.segments.find(s => s.segmentId === selectedSegmentId)
    const ann = deepClone(segment ? getEffectiveAnnotation(segment) : null)
    if (!ann) return
    ann.scene = scene
    ann.camera = camera
    const legacySpeech = (ann.events || [])
      .filter(event => event.type.startsWith('[Speech]'))
      .map(event => event.type.replace(/^\[Speech\]\s*/, '').trim())
      .filter(Boolean)
      .join('\n')
    ann.speechTranscript = ann.speechTranscript || legacySpeech || undefined
    ann.events = events
    ann._humanEdited = true
    const newSet: AnnotateSet = { ...set, videos: set.videos.map(video => video.videoId !== selectedVideoId ? video : ({
      ...video,
      segments: video.segments.map(current => current.segmentId !== selectedSegmentId ? current : ({ ...current, humanAnnotation: ann })),
    })) }
    persistSegmentAnnotation(newSet, selectedVideoId, selectedSegmentId, ann)
  }, [set, selectedVideoId, selectedSegmentId, persistSegmentAnnotation])

  const handleJsonSave = useCallback((updated: SegmentAnnotation) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const currentSegment = set.videos
      ?.find(video => video.videoId === selectedVideoId)
      ?.segments?.find(segment => segment.segmentId === selectedSegmentId)
    const currentAnnotation = getEffectiveAnnotation(currentSegment || { humanAnnotation: null, modelAnnotation: null })
    const legacySpeech = (updated.events || [])
      .filter(event => event.type.startsWith('[Speech]'))
      .map(event => event.type.replace(/^\[Speech\]\s*/, '').trim())
      .filter(Boolean)
      .join('\n')
    const annotationWithRecognition: SegmentAnnotation = {
      ...updated,
      speechTranscript: updated.speechTranscript || legacySpeech || currentAnnotation?.speechTranscript,
      objects: updated.objects || [],
      events: (updated.events || []).filter(event => !event.type.startsWith('[Speech]')),
      _recognition: currentAnnotation?._recognition,
      _pipeline_errors: currentAnnotation?._pipeline_errors,
      _provider_statuses: currentAnnotation?._provider_statuses,
      _pipeline_status: currentAnnotation?._pipeline_status,
      _humanEdited: true,
    }
    const newSet: AnnotateSet = {
      ...set,
      videos: (set.videos || []).map(v => {
        if (v.videoId !== selectedVideoId) return v
        return { ...v, segments: (v.segments || []).map(s => s.segmentId !== selectedSegmentId ? s : { ...s, humanAnnotation: annotationWithRecognition }) }
      }),
    }
    persistSegmentAnnotation(newSet, selectedVideoId, selectedSegmentId, annotationWithRecognition)
  }, [set, selectedVideoId, selectedSegmentId, persistSegmentAnnotation])

  const handleSaveTextContent = useCallback((edits: TextContentEdits) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const video = (set.videos || []).find(item => item.videoId === selectedVideoId)
    const segment = video?.segments?.find(item => item.segmentId === selectedSegmentId)
    const currentAnnotation = getEffectiveAnnotation(segment || { humanAnnotation: null, modelAnnotation: null })
    if (!currentAnnotation) return

    const annotation = deepClone(currentAnnotation)
    const correctedOcr = new Map(edits.ocr.map(item => [item.trackId, item.text.trim()]))
    annotation.objects = (annotation.objects || []).flatMap(object => {
      if (!object._textContent || !correctedOcr.has(object.trackId)) return [object]
      const correctedText = correctedOcr.get(object.trackId) || ''
      if (!correctedText) return []
      return [{
        ...object,
        name: correctedText.slice(0, 80),
        _textContent: correctedText,
      }]
    })
    annotation.speechTranscript = edits.speechTranscript.trim() || undefined
    annotation.events = (annotation.events || [])
      .filter(event => !event.type.startsWith('[Speech]'))
    annotation._humanEdited = true

    const newSet: AnnotateSet = {
      ...set,
      videos: (set.videos || []).map(item => {
        if (item.videoId !== selectedVideoId) return item
        return {
          ...item,
          segments: (item.segments || []).map(current => (
            current.segmentId === selectedSegmentId
              ? { ...current, humanAnnotation: annotation }
              : current
          )),
        }
      }),
    }
    persistSegmentAnnotation(newSet, selectedVideoId, selectedSegmentId, annotation)
  }, [set, selectedVideoId, selectedSegmentId, persistSegmentAnnotation])

  const handleSaveEdits = useCallback((
    edits: PersonAnnotation | ObjectAnnotation,
    scope: ObjectLabelRenameScope = 'track',
    sourceLabels: string[] = [],
    frameIndex?: number,
  ) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const segment = set.videos.find(v => v.videoId === selectedVideoId)?.segments.find(s => s.segmentId === selectedSegmentId)
    let ann = deepClone(segment ? getEffectiveAnnotation(segment) : null)
    if (!ann) return
    if ('gender' in edits) {
      ann.persons = (ann.persons || []).map(p => p.trackId === edits.trackId ? edits as PersonAnnotation : p)
    } else {
      const previous = (ann.objects || []).find(object => object.trackId === edits.trackId)
      const normalizedEdits = { ...edits, name: edits.name.trim() } as ObjectAnnotation
      if (!normalizedEdits.name) return
      if (previous) {
        if (scope !== 'frame') {
          ann.objects = (ann.objects || []).map(object => (
            object.trackId === normalizedEdits.trackId ? normalizedEdits : object
          ))
        }
        ann = renameObjectLabel(
          ann,
          normalizedEdits.trackId,
          [previous.name, ...sourceLabels],
          normalizedEdits.name,
          scope,
          frameIndex,
        )
      }
    }
    ann._humanEdited = true
    const newSet: AnnotateSet = { ...set, videos: set.videos.map(video => video.videoId !== selectedVideoId ? video : ({
      ...video,
      segments: video.segments.map(current => current.segmentId !== selectedSegmentId ? current : ({ ...current, humanAnnotation: ann })),
    })) }
    persistSegmentAnnotation(newSet, selectedVideoId, selectedSegmentId, ann)
  }, [set, selectedVideoId, selectedSegmentId, persistSegmentAnnotation])

  // ── Derived data ───────────────────────────────────

  const allSegments = useMemo(() => scopedVideos.flatMap(v =>
    (v.segments || []).map(s => ({ ...s, videoId: v.videoId, videoName: v.fileName }))
  ), [scopedVideos])
  const failedSegments = useMemo(
    () => allSegments.filter(segment => (
      segment.status === 'failed' || segment.status === 'partial_completed'
    )),
    [allSegments],
  )
  const selectedFailedCount = useMemo(
    () => failedSegments.filter(segment => (
      selectedFailedSegments.has(`${segment.videoId}_${segment.segmentId}`)
    )).length,
    [failedSegments, selectedFailedSegments],
  )

  const pipelinePhase = useMemo(() => {
    const processing = allSegments.find(s => s.status === 'processing')
    return processing?.progressPhase || ''
  }, [allSegments])

  const annotationProgress = useMemo(() => {
    const total = allSegments.length
    if (total === 0) return 0
    const done = allSegments.filter(s => (
      s.status === 'completed' || s.status === 'partial_completed'
    )).length
    const processing = allSegments.filter(s => s.status === 'processing').length
    return Math.round(((done + processing * 0.5) / total) * 100)
  }, [allSegments])

  // ── Polling ────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'annotating') { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }; return }
    pollRef.current = setInterval(() => fetchSet(), 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [phase, fetchSet])

  // ── Selected video/segment ─────────────────────────

  const selectedVideo: VideoTaskItem | undefined = scopedVideos.find(v => v.videoId === selectedVideoId) || scopedVideos[0]
  const selectedSegment = (selectedVideo?.segments || []).find(s => s.segmentId === selectedSegmentId) || selectedVideo?.segments?.[0]
  const activeAnnotation: SegmentAnnotation | null = getEffectiveAnnotation(selectedSegment || { humanAnnotation: null, modelAnnotation: null })
  const recognitionStatus = activeAnnotation?._recognition || selectedSegment?.modelAnnotation?._recognition
  const pipelineErrors = activeAnnotation?._pipeline_errors || selectedSegment?.modelAnnotation?._pipeline_errors || []
  const manualSplitEligible = Boolean(
    selectedVideo
    && selectedVideo.segments.length > 0
    && selectedVideo.segments.every(isUntouchedDraftSegment),
  )
  const manualSplitSnappedTime = useMemo(() => {
    if (!selectedVideo || !selectedSegment || manualSplitTime == null) return null
    const fps = selectedVideo.fps > 0 ? selectedVideo.fps : 30
    return Number((Math.round(manualSplitTime * fps) / fps).toFixed(6))
  }, [selectedVideo, selectedSegment, manualSplitTime])
  const manualSplitCanCommit = Boolean(
    manualSplitEligible
    && selectedSegment
    && manualSplitSnappedTime != null
    && manualSplitSnappedTime - selectedSegment.start >= MIN_MANUAL_SEGMENT_DURATION
    && selectedSegment.end - manualSplitSnappedTime >= MIN_MANUAL_SEGMENT_DURATION,
  )

  const handleToggleManualSplit = useCallback(() => {
    if (!selectedSegment || !manualSplitEligible) return
    setManualSplitError(null)
    setManualSplitMode(current => {
      const next = !current
      if (next) {
        const currentTime = manualSplitTime
        const safelyInside = currentTime != null
          && currentTime - selectedSegment.start >= MIN_MANUAL_SEGMENT_DURATION
          && selectedSegment.end - currentTime >= MIN_MANUAL_SEGMENT_DURATION
        if (!safelyInside) {
          setManualSplitTime(selectedSegment.start + (selectedSegment.end - selectedSegment.start) / 2)
        }
      }
      return next
    })
  }, [selectedSegment, manualSplitEligible, manualSplitTime])

  const handleManualSplit = useCallback(async () => {
    if (
      !set || !selectedVideo || !selectedSegment || manualSplitSnappedTime == null
      || !manualSplitCanCommit || manualSplitSaving
    ) return
    if (!confirm(t(
      'video.manual_split_confirm',
      formatSplitTime(manualSplitSnappedTime),
      formatSplitTime(selectedSegment.start),
      formatSplitTime(selectedSegment.end),
    ))) return

    setManualSplitSaving(true)
    setManualSplitError(null)
    try {
      const response = await fetch(`/api/video-annotation/annotate-sets/${annotateId}/segments/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: selectedVideo.videoId,
          segmentId: selectedSegment.segmentId,
          splitTime: manualSplitSnappedTime,
        }),
      })
      const payload = await response.json().catch(() => ({})) as {
        data?: AnnotateSet
        split?: { rightSegmentId?: number }
      }
      if (!response.ok || !payload.data) {
        setManualSplitError(apiErrorMessage(payload, t('video.manual_split_failed')))
        return
      }
      setSet(payload.data)
      setSelectedSegmentId(payload.split?.rightSegmentId ?? null)
      setSelectedFrameIndex(null)
      setSelectedTrackId(null)
      setSelectedEntityType(null)
      setManualSplitMode(false)
    } catch (error) {
      setManualSplitError(`${t('video.manual_split_failed')}: ${String(error)}`)
    } finally {
      setManualSplitSaving(false)
    }
  }, [
    set, selectedVideo, selectedSegment, manualSplitSnappedTime, manualSplitCanCommit,
    manualSplitSaving, t, annotateId,
  ])

  const selectedFrame = useMemo(() => {
    if (!activeAnnotation || !selectedSegment || !selectedVideo) return null
    return editingFrameFor(activeAnnotation, selectedSegment, selectedVideo, selectedFrameIndex)
  }, [activeAnnotation, selectedSegment, selectedVideo, selectedFrameIndex])

  const selectedObjectSourceLabels = useMemo(() => {
    if (selectedTrackId == null || selectedEntityType !== 'object') return []
    const labels = new Set<string>()
    const add = (value: string | undefined) => {
      const normalized = value?.trim()
      if (normalized) labels.add(normalized)
    }

    add(selectedFrame?.observations.find(observation => (
      observation.trackId === selectedTrackId && observation.entityType === 'object'
    ))?.className)

    const modelAnnotation = selectedSegment?.modelAnnotation
    add(modelAnnotation?.objects?.find(object => object.trackId === selectedTrackId)?.name)
    for (const frame of modelAnnotation?.frames || []) {
      for (const observation of frame.observations || []) {
        if (observation.trackId === selectedTrackId && observation.entityType === 'object') {
          add(observation.className)
        }
      }
    }
    return [...labels]
  }, [selectedTrackId, selectedEntityType, selectedFrame, selectedSegment])

  const handleConvertEntityType = useCallback((
    scope: 'frame' | 'track',
    targetType: SpatialEntityType,
    objectLabel?: string,
  ) => {
    if (
      !set || !selectedVideo || !selectedSegment || !activeAnnotation || !selectedFrame
      || selectedTrackId == null || selectedEntityType == null
    ) return
    const sourceRef: TrackRef = { trackId: selectedTrackId, entityType: selectedEntityType }
    const normalizedLabel = objectLabel?.trim()
    if (targetType === 'object' && !normalizedLabel) return

    if (scope === 'frame') {
      let annotation = deepClone(activeAnnotation)
      if (!annotation.frames?.some(frame => frame.frameIndex === selectedFrame.frameIndex)) {
        annotation = upsertFrame(annotation, selectedFrame)
      }
      annotation = convertEntityType(
        annotation,
        sourceRef,
        targetType,
        'frame',
        selectedFrame.frameIndex,
        normalizedLabel,
      )
      const nextSet: AnnotateSet = {
        ...set,
        videos: set.videos.map(video => video.videoId !== selectedVideo.videoId ? video : ({
          ...video,
          segments: video.segments.map(segment => segment.segmentId !== selectedSegment.segmentId
            ? segment
            : { ...segment, humanAnnotation: annotation }),
        })),
      }
      setSelectedEntityType(targetType)
      persistSegmentAnnotation(nextSet, selectedVideo.videoId, selectedSegment.segmentId, annotation)
      return
    }

    const selectedPersonId = selectedEntityType === 'person'
      ? activeAnnotation.persons.find(person => person.trackId === selectedTrackId)?.personId
      : null
    const selectedObjectName = selectedEntityType === 'object'
      ? activeAnnotation.objects.find(object => object.trackId === selectedTrackId)?.name
      : null
    const selectedConvertedPersonId = selectedEntityType === 'object'
      ? activeAnnotation.objects.find(object => object.trackId === selectedTrackId)?._convertedPersonId
      : null
    const convertedBySegment = new Map<number, SegmentAnnotation>()

    for (const segment of selectedVideo.segments) {
      const source = getEffectiveAnnotation(segment)
      if (!source) continue
      let segmentTrackId: number | null = null
      if (selectedEntityType === 'person') {
        const person = selectedPersonId
          ? source.persons.find(item => item.personId === selectedPersonId)
          : source.persons.find(item => item.trackId === selectedTrackId)
        segmentTrackId = person?.trackId ?? null
      } else {
        const object = selectedConvertedPersonId
          ? source.objects.find(item => item._convertedPersonId === selectedConvertedPersonId)
          : source.objects.find(item => (
            item.trackId === selectedTrackId
            && (!selectedObjectName || item.name === selectedObjectName)
          ))
        segmentTrackId = object?.trackId ?? null
      }
      if (segmentTrackId == null) continue

      let annotation = deepClone(source)
      if (!annotation.frames?.length) {
        annotation = upsertFrame(annotation, editingFrameFor(annotation, segment, selectedVideo, null))
      }
      const segmentRef: TrackRef = { trackId: segmentTrackId, entityType: selectedEntityType }
      const converted = convertEntityType(annotation, segmentRef, targetType, 'track', null, normalizedLabel)
      if (converted !== annotation) convertedBySegment.set(segment.segmentId, converted)
    }
    if (convertedBySegment.size === 0) return

    const nextSet: AnnotateSet = {
      ...set,
      videos: set.videos.map(video => video.videoId !== selectedVideo.videoId ? video : ({
        ...video,
        segments: video.segments.map(segment => {
          const annotation = convertedBySegment.get(segment.segmentId)
          return annotation ? { ...segment, humanAnnotation: annotation } : segment
        }),
      })),
    }
    setSelectedEntityType(targetType)
    persistAnnotationUpdates(
      nextSet,
      selectedVideo.videoId,
      [...convertedBySegment].map(([segmentId, annotation]) => ({ segmentId, annotation })),
    )
  }, [
    set, selectedVideo, selectedSegment, activeAnnotation, selectedFrame,
    selectedTrackId, selectedEntityType, persistSegmentAnnotation, persistAnnotationUpdates,
  ])

  const frameEntities = useMemo(() => (
    activeAnnotation && selectedFrame
      ? frameDisplayEntities(activeAnnotation, selectedFrame)
      : { persons: [], objects: [] }
  ), [activeAnnotation, selectedFrame])
  const ocrTrackIds = useMemo(() => new Set(
    (activeAnnotation?.objects || [])
      .filter(object => object._textContent || object.category.trim().toLowerCase() === 'text')
      .map(object => object.trackId),
  ), [activeAnnotation])
  const visibleFramePersonCount = useMemo(() => (
    selectedFrame?.observations.filter(observation => observation.entityType === 'person').length || 0
  ), [selectedFrame])
  const visibleFrameObjectCount = useMemo(() => (
    selectedFrame?.observations.filter(observation => (
      observation.entityType === 'object' && !ocrTrackIds.has(observation.trackId)
    )).length || 0
  ), [selectedFrame, ocrTrackIds])
  const visibleFrameOcrCount = useMemo(() => (
    selectedFrame?.observations.filter(observation => (
      observation.entityType === 'object' && ocrTrackIds.has(observation.trackId)
    )).length || 0
  ), [selectedFrame, ocrTrackIds])
  const segmentPersonTrackCount = activeAnnotation?.persons?.length || 0
  const segmentObjectTrackCount = useMemo(() => (
    (activeAnnotation?.objects || []).filter(object => !ocrTrackIds.has(object.trackId)).length
  ), [activeAnnotation, ocrTrackIds])
  const segmentOcrTrackCount = useMemo(() => (
    (activeAnnotation?.objects || []).filter(object => ocrTrackIds.has(object.trackId)).length
  ), [activeAnnotation, ocrTrackIds])
  const activePendingTrackKeys = useMemo(() => {
    if (!selectedVideoId || selectedSegmentId == null || !selectedFrame) return new Set<string>()
    const prefix = `${selectedVideoId}:${selectedSegmentId}:${selectedFrame.frameIndex}:`
    return new Set([...pendingDeletes].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)))
  }, [pendingDeletes, selectedVideoId, selectedSegmentId, selectedFrame])

  // Display arrays with pending deletes filtered out (track still exists in annotation, just visually hidden)
  const displayPersons = useMemo(() =>
    frameEntities.persons.filter(p => !activePendingTrackKeys.has(`person:${p.trackId}`)),
    [frameEntities, activePendingTrackKeys]
  )
  const displayObjects = useMemo(() =>
    frameEntities.objects.filter(o => !activePendingTrackKeys.has(`object:${o.trackId}`)),
    [frameEntities, activePendingTrackKeys]
  )

  const handleFrameSeek = useCallback((timestamp: number) => {
    const frame = nearestFrame(activeAnnotation?.frames, timestamp)
    if (frame) setSelectedFrameIndex(frame.frameIndex)
    setSelectedTrackId(null)
    setSelectedEntityType(null)
    setCanvasMode('view')
  }, [activeAnnotation])

  const handleExportCurrentFrame = useCallback(async () => {
    if (!selectedVideo || !selectedSegment || !activeAnnotation || !selectedFrame) return
    await downloadAsFile(
      exportCurrentFrameJson(activeAnnotation, selectedFrame),
      `${selectedVideo.videoId}_segment_${selectedSegment.segmentId}_frame_${selectedFrame.frameIndex}.json`,
    )
  }, [selectedVideo, selectedSegment, activeAnnotation, selectedFrame])

  const handleAnalyzeSelectedPerson = useCallback(async (
    trackId: number,
    frameIndex: number,
  ): Promise<PersonAnalysisResult> => {
    if (!selectedVideoId || selectedSegmentId == null) {
      throw new Error('Select a video segment before analyzing a person.')
    }
    const response = await fetch(`/api/video-annotation/annotate-sets/${annotateId}/person-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: selectedVideoId,
        segmentId: selectedSegmentId,
        frameIndex,
        trackId,
      }),
    })
    const submitted = await response.json().catch(() => null) as {
      data?: { jobId?: string }
      error?: unknown
    } | null
    if (!response.ok || !submitted?.data?.jobId) {
      throw new Error(apiErrorMessage(submitted, `Person analysis failed (HTTP ${response.status})`))
    }

    for (let attempt = 0; attempt < 180; attempt += 1) {
      await waitFor(1000)
      const statusResponse = await fetch(
        `/api/video-annotation/annotate-sets/${annotateId}/person-analysis?jobId=${encodeURIComponent(submitted.data.jobId)}`,
        { cache: 'no-store' },
      )
      const statusPayload = await statusResponse.json().catch(() => null) as {
        data?: {
          status?: string
          result?: PersonAnalysisResult | null
          error?: string | null
        }
        error?: unknown
      } | null
      if (!statusResponse.ok || !statusPayload?.data) {
        throw new Error(apiErrorMessage(statusPayload, `Person analysis status failed (HTTP ${statusResponse.status})`))
      }
      if (statusPayload.data.status === 'completed' && statusPayload.data.result) {
        return statusPayload.data.result
      }
      if (statusPayload.data.status === 'failed' || statusPayload.data.status === 'cancelled') {
        throw new Error(statusPayload.data.error || 'Person analysis did not complete.')
      }
    }
    throw new Error('Person analysis timed out after 3 minutes.')
  }, [annotateId, selectedVideoId, selectedSegmentId])

  // ── Keyboard delete ────────────────────────────────

  useEffect(() => {
    if (selectedTrackId == null || selectedEntityType == null) return
    const h = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        handleDeleteTrack(selectedTrackId, selectedEntityType)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selectedTrackId, selectedEntityType, handleDeleteTrack])

  // Flush pending deletes when switching video or segment
  const prevVideoSegRef = useRef(`${selectedVideoId || ''}_${selectedSegmentId ?? ''}_${selectedFrame?.frameIndex ?? ''}`)
  useEffect(() => {
    const key = `${selectedVideoId || ''}_${selectedSegmentId ?? ''}_${selectedFrame?.frameIndex ?? ''}`
    if (prevVideoSegRef.current !== key) {
      prevVideoSegRef.current = key
      flushPendingDeletes()
    }
  }, [selectedVideoId, selectedSegmentId, selectedFrame?.frameIndex, flushPendingDeletes])

  // ── Render ─────────────────────────────────────────

  if (loading) return <div className="flex-1 flex items-center justify-center"><p className="text-gv-text-dim">Loading...</p></div>
  if (!set) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center"><p className="text-lg text-gv-text-dim">Annotation set not found</p>
        <Link href="/annotations" className="text-sm text-gv-pink hover:underline mt-2 inline-block">Back</Link>
      </div>
    </div>
  )
  if (routeVideoId && scopedVideos.length === 0) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center"><p className="text-lg text-gv-text-dim">{t('video.video_not_found')}</p>
        <Link href={`/annotations/${annotateId}`} className="text-sm text-gv-pink hover:underline mt-2 inline-block">{t('video.back_to_project')}</Link>
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <WorkspaceHeader />
      <main className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-gv-border/50 bg-gv-surface">
        <Link href={routeVideoId ? `/annotations/${annotateId}` : '/annotations'} className="text-gv-text-dim hover:text-gv-pink transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Link>
        {routeVideoId ? (
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gv-text-muted truncate">{set.name}</p>
            <h1 className="text-lg font-semibold text-gv-text truncate">{selectedVideo?.fileName || set.name}</h1>
          </div>
        ) : (
          <h1 className="text-lg font-semibold text-gv-text flex-1 truncate">{set.name}</h1>
        )}
        <span className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
          workerStatus === 'ok' ? 'bg-gv-green-deep/10 text-gv-green-deep' : workerStatus === 'checking' ? 'bg-gv-gold/10 text-gv-gold' : 'bg-gv-pink/10 text-gv-pink'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${workerStatus === 'ok' ? 'bg-gv-green-deep' : workerStatus === 'checking' ? 'bg-gv-gold' : 'bg-gv-pink'}`} />
          Worker: {workerStatus}
        </span>
        {!routeVideoId && (set.videos?.length || 0) > 0 && (
          <button
            onClick={() => setShowUpload(true)}
            disabled={transition === 'uploading'}
            className="btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            + {t('video.add_videos')}
          </button>
        )}
        {allSegments.some(s => s.status === 'completed') && (
          <>
            {selectedSegmentId != null && (
              <button
                onClick={() => setShowSegmentExport(true)}
                disabled={exporting}
                title="Exports the current segment; corrected OCR and speech can be included from the export dialog."
                className="btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50"
              >
                {exporting ? t('video.generating_summary') : t('video.export_current_segment')}
              </button>
            )}
            <button onClick={() => setShowExport(true)} disabled={exporting} className="btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50">
              {t('video.export_all_annotations')}
            </button>
          </>
        )}
      </div>

      {!routeVideoId && phase === 'no_videos' && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-2xl">
            <h2 className="text-lg font-semibold text-gv-text mb-2">Upload Videos</h2>
            <p className="text-sm text-gv-text-dim mb-6">Upload videos to begin the annotation pipeline.</p>
            <VideoBatchUploader onFiles={handleUpload} />
          </div>
        </div>
      )}

      {scopedVideos.length > 0 && allSegments.length === 0 && phase !== 'uploading' && phase !== 'detecting' && phase !== 'annotating' && (
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-lg font-semibold text-gv-text mb-4">{selectedVideo?.fileName || `Videos (${scopedVideos.length})`}</h2>
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg border border-gv-border bg-gv-bg-deep">
              <span className="text-xs text-gv-text-dim shrink-0">Scene sensitivity:</span>
              <input type="range" min="0.15" max="0.8" step="0.05" value={sceneThreshold} onChange={e => setSceneThreshold(parseFloat(e.target.value))} className="flex-1 accent-gv-pink h-2" />
              <span className="text-xs text-gv-pink font-mono min-w-[3ch]">{sceneThreshold.toFixed(2)}</span>
              <span className="text-xs text-gv-text-muted">(lower = more segments)</span>
            </div>
            <div className="space-y-3">
              {scopedVideos.map(v => (
                <div key={v.videoId} className="card p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gv-text truncate">{v.fileName}</p>
                    <p className="text-xs text-gv-text-dim mt-0.5">{v.duration ? `${v.duration.toFixed(1)}s` : 'Processing...'}{v.width ? ` | ${v.width}x${v.height}` : ''}</p>
                  </div>
                  <button onClick={() => handleDetectScenes(v.videoId)} className="rounded-lg px-4 py-2 text-sm bg-gv-green/20 text-gv-green-deep hover:bg-gv-green/30 transition-colors font-medium">Detect Scenes</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {phase === 'uploading' && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-md text-center">
            <div className="animate-spin w-8 h-8 border-2 border-gv-pink border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-sm text-gv-text-dim">Uploading videos...</p>
            {Object.entries(uploadProgress).map(([name, pct]) => (
              <div key={name} className="flex items-center gap-2 mt-2 text-xs text-gv-text-dim">
                <span className="truncate flex-1 text-left">{name}</span>
                <span className={`w-12 text-right ${pct < 0 ? 'text-gv-pink' : ''}`}>{pct < 0 ? 'Failed' : `${pct}%`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'segments_pending' && (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-1/2 border-r border-gv-border/50 flex flex-col">
            {selectedVideo && (
              <>
                <div className="flex-1 flex items-center justify-center p-4"><VideoPlayer
                  src={`/api/video-annotation/files/${selectedVideo.videoId}`}
                  startTime={selectedSegment?.start || 0}
                  currentTime={manualSplitMode && manualSplitTime != null ? manualSplitTime : undefined}
                  fps={selectedVideo.fps || 30}
                  onFrameSeek={handleSplitCursorSeek}
                /></div>
                <div className="border-t border-gv-border/50 px-4 py-3">
                  <div className="relative flex h-8 overflow-hidden rounded-lg border border-gv-border bg-gv-bg-deep">
                    {(selectedVideo.segments || []).map(segment => (
                      <button
                        key={segment.segmentId}
                        type="button"
                        title={`Segment ${segment.segmentId}: ${formatSplitTime(segment.start)} - ${formatSplitTime(segment.end)}`}
                        onClick={() => {
                          setSelectedVideoId(selectedVideo.videoId)
                          setSelectedSegmentId(segment.segmentId)
                          setSelectedFrameIndex(null)
                          setSelectedTrackId(null)
                          setSelectedEntityType(null)
                        }}
                        style={{ flexGrow: Math.max(segment.end - segment.start, 0.001), flexBasis: 0 }}
                        className={`min-w-px border-r border-gv-surface transition-colors ${
                          selectedSegment?.segmentId === segment.segmentId
                            ? 'bg-gv-pink/25'
                            : 'bg-gv-green/15 hover:bg-gv-green/25'
                        }`}
                      />
                    ))}
                    {manualSplitMode && manualSplitTime != null && selectedVideo.duration > 0 && (
                      <span
                        className="pointer-events-none absolute inset-y-0 w-0.5 bg-gv-pink shadow-[0_0_6px_rgba(255,94,180,0.8)]"
                        style={{ left: `${Math.min(100, Math.max(0, manualSplitTime / selectedVideo.duration * 100))}%` }}
                      />
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-gv-text-muted">
                    <span>{selectedSegment ? `Segment ${selectedSegment.segmentId}: ${formatSplitTime(selectedSegment.start)} - ${formatSplitTime(selectedSegment.end)}` : t('video.manual_split_select_segment')}</span>
                    <span className="flex-1" />
                    <span>{selectedVideo.segments.length} {t('video.manual_split_segments')}</span>
                  </div>
                  {manualSplitMode && selectedSegment && manualSplitSnappedTime != null && (
                    <div className="mt-3 rounded-lg border border-gv-pink/30 bg-gv-pink/5 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-gv-pink">{t('video.manual_split_title')}</span>
                        <span className="text-xs text-gv-text-muted">{t('video.manual_split_at')}</span>
                        <input
                          type="number"
                          min={selectedSegment.start}
                          max={selectedSegment.end}
                          step={1 / Math.max(selectedVideo.fps || 30, 1)}
                          value={manualSplitSnappedTime}
                          onChange={event => setManualSplitTime(Number(event.target.value))}
                          className="w-28 rounded border border-gv-border bg-gv-bg px-2 py-1 font-mono text-xs text-gv-text"
                        />
                        <span className="font-mono text-xs text-gv-text">{formatSplitTime(manualSplitSnappedTime)}</span>
                        <span className="flex-1" />
                        <button
                          type="button"
                          onClick={() => void handleManualSplit()}
                          disabled={!manualSplitCanCommit || manualSplitSaving}
                          className="btn-primary rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {manualSplitSaving ? t('video.manual_split_saving') : t('video.manual_split_here')}
                        </button>
                        <button
                          type="button"
                          onClick={handleToggleManualSplit}
                          disabled={manualSplitSaving}
                          className="rounded-lg px-3 py-1.5 text-xs text-gv-text-muted hover:bg-gv-bg"
                        >
                          {t('video.manual_split_cancel')}
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded bg-gv-bg px-2 py-1.5 text-gv-text-dim">
                          {t('video.manual_split_left')}: {formatSplitTime(selectedSegment.start)} - {formatSplitTime(manualSplitSnappedTime)}
                        </div>
                        <div className="rounded bg-gv-bg px-2 py-1.5 text-gv-text-dim">
                          {t('video.manual_split_right')}: {formatSplitTime(manualSplitSnappedTime)} - {formatSplitTime(selectedSegment.end)}
                        </div>
                      </div>
                      {!manualSplitCanCommit && (
                        <p className="mt-2 text-xs text-gv-gold-dark">{t('video.manual_split_minimum', MIN_MANUAL_SEGMENT_DURATION.toFixed(1))}</p>
                      )}
                      <p className="mt-2 text-xs text-gv-text-muted">{t('video.manual_split_hint')}</p>
                    </div>
                  )}
                  {manualSplitError && <p className="mt-2 text-xs text-gv-pink">{manualSplitError}</p>}
                  {!manualSplitEligible && (
                    <p className="mt-2 text-xs text-gv-text-muted">{t('video.manual_split_draft_only')}</p>
                  )}
                </div>
                <div className="border-t border-gv-border/50 p-3 flex items-center justify-between">
                  <span className="text-sm text-gv-text-dim truncate">{selectedVideo.fileName}</span>
                  {workerStatus === 'ok' && <button onClick={handleAnnotateAll} className="btn-primary rounded-lg px-4 py-2 text-sm">Annotate All Segments</button>}
                </div>
              </>
            )}
          </div>
          <div className="w-1/2 flex flex-col overflow-auto p-4">
            <h3 className="text-sm font-semibold text-gv-text mb-3 flex items-center gap-2">
              Segments ({allSegments.length})
              {allSegments.filter(s => s.status === 'completed' || s.status === 'partial_completed').length > 0 && <span className="text-xs text-gv-text-muted font-normal">({allSegments.filter(s => s.status === 'completed' || s.status === 'partial_completed').length} done)</span>}
              <span className="flex-1" />
              {selectedVideo && (
                <>
                  <input type="range" min="0.15" max="0.8" step="0.05" value={sceneThreshold} onChange={e => setSceneThreshold(parseFloat(e.target.value))} className="w-20 accent-gv-pink h-1.5" />
                  <span className="text-xs text-gv-text-muted font-mono w-8 text-right">{sceneThreshold.toFixed(2)}</span>
                  <button onClick={() => handleDetectScenes(selectedVideo.videoId)} className="px-2 py-0.5 rounded text-xs bg-gv-pink/10 text-gv-pink hover:bg-gv-pink/20" title="Re-detect scenes">Re-detect</button>
                  <button
                    type="button"
                    onClick={handleToggleManualSplit}
                    disabled={!manualSplitEligible || manualSplitSaving}
                    title={manualSplitEligible ? t('video.manual_split_title') : t('video.manual_split_draft_only')}
                    className={`px-2 py-0.5 rounded text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                      manualSplitMode
                        ? 'bg-gv-pink text-white'
                        : 'bg-gv-green/15 text-gv-green-deep hover:bg-gv-green/25'
                    }`}
                  >
                    {t('video.manual_split_title')}
                  </button>
                </>
              )}
            </h3>
            {failedSegments.length > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-gv-pink/25 bg-gv-pink/5 px-3 py-2">
                <span className="text-xs text-gv-pink">{t('video.retryable_segments', failedSegments.length)}</span>
                <button
                  onClick={() => setSelectedFailedSegments(new Set(failedSegments.map(segment => `${segment.videoId}_${segment.segmentId}`)))}
                  className="rounded px-2 py-1 text-xs text-gv-text-dim hover:bg-gv-bg"
                >
                  {t('video.select_all_retryable')}
                </button>
                {selectedFailedCount > 0 && (
                  <button
                    onClick={() => setSelectedFailedSegments(new Set())}
                    className="rounded px-2 py-1 text-xs text-gv-text-dim hover:bg-gv-bg"
                  >
                    {t('video.clear_selection')}
                  </button>
                )}
                <span className="flex-1" />
                <button
                  onClick={handleRetrySelectedFailed}
                  disabled={selectedFailedCount === 0 || retryingSelected || workerStatus !== 'ok'}
                  className="btn-primary rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {retryingSelected ? t('video.retrying_selected') : t('video.retry_selected', selectedFailedCount)}
                </button>
              </div>
            )}
            <div className="space-y-2">
              {allSegments.map(seg => (
                <div
                  key={`${seg.videoId}_${seg.segmentId}`}
                  className={`card p-3 flex items-center gap-3 transition-all ${selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId ? 'border-gv-pink' : ''}`}
                >
                  {(seg.status === 'failed' || seg.status === 'partial_completed') && (
                    <input
                      type="checkbox"
                      aria-label={t('video.select_retryable_segment', seg.segmentId)}
                      checked={selectedFailedSegments.has(`${seg.videoId}_${seg.segmentId}`)}
                      onChange={event => {
                        const key = `${seg.videoId}_${seg.segmentId}`
                        setSelectedFailedSegments(previous => {
                          const next = new Set(previous)
                          if (event.target.checked) next.add(key)
                          else next.delete(key)
                          return next
                        })
                      }}
                      className="h-3.5 w-3.5 accent-gv-pink"
                    />
                  )}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    seg.status === 'completed' ? 'bg-gv-green-deep' : seg.status === 'partial_completed' ? 'bg-gv-gold' : seg.status === 'processing' ? 'bg-gv-gold animate-pulse' : seg.status === 'failed' ? 'bg-gv-pink' : 'bg-gv-text-muted'
                  }`} />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVideoId(seg.videoId)
                      setSelectedSegmentId(seg.segmentId)
                      setSelectedFrameIndex(null)
                      setSelectedTrackId(null)
                      setSelectedEntityType(null)
                      setManualSplitError(null)
                    }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm font-medium text-gv-text">Segment {seg.segmentId}</p>
                    <p className="text-xs text-gv-text-dim">{seg.start.toFixed(1)}s – {seg.end.toFixed(1)}s ({seg.videoName})</p>
                  </button>
                  <span className="text-xs text-gv-text-muted capitalize">
                    {seg.status === 'processing' && seg.processingMode === 'precision'
                      ? t('video.precision_running')
                      : seg.status}
                  </span>
                  {(seg.status === 'completed' || seg.status === 'partial_completed') && seg.lastCompletedMode && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                      seg.lastCompletedMode === 'precision'
                        ? 'bg-gv-pink/10 text-gv-pink'
                        : 'bg-gv-bg-deep text-gv-text-muted'
                    }`}>
                      {seg.lastCompletedMode === 'precision'
                        ? t('video.mode_precision')
                        : t('video.mode_standard')}
                    </span>
                  )}
                  {seg.status === 'failed' && (
                    <>
                      <span className="text-xs text-gv-gold truncate max-w-[140px]" title={(seg as unknown as Record<string,string>).error}>{(seg as unknown as Record<string,string>).error || 'Pipeline error'}</span>
                      {((seg as unknown as Record<string,unknown>).modelAnnotation as Record<string,unknown>) && (
                        <button onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setSelectedFrameIndex(null); setSelectedTrackId(null); setSelectedEntityType(null); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-gold/10 text-gv-gold-dark hover:bg-gv-gold/20 ml-2">Review Partial</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20">Retry</button>
                    </>
                  )}
                  {seg.status === 'partial_completed' && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setSelectedFrameIndex(null); setSelectedTrackId(null); setSelectedEntityType(null); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-gold/10 text-gv-gold-dark hover:bg-gv-gold/20 ml-2">{t('video.review_degraded')}</button>
                      <button onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20">{t('video.retry_degraded')}</button>
                    </>
                  )}
                  {seg.status === 'completed' && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setSelectedFrameIndex(null); setSelectedTrackId(null); setSelectedEntityType(null); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-pink/10 text-gv-pink hover:bg-gv-pink/20 ml-2">Review</button>
                      <button onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20" title="Re-annotate">Re-run</button>
                    </>
                  )}
                  {seg.status !== 'completed' && seg.status !== 'partial_completed' && seg.status !== 'processing' && seg.status !== 'failed' && workerStatus === 'ok' && (
                    <button onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} disabled={annotatingSegments.has(`${seg.videoId}_${seg.segmentId}`)} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20 disabled:opacity-50 ml-2">
                      {annotatingSegments.has(`${seg.videoId}_${seg.segmentId}`) ? '...' : 'Annotate'}
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteSegment(seg.videoId, seg.segmentId) }} className="rounded px-2 py-0.5 text-xs text-gv-text-muted hover:text-gv-pink hover:bg-gv-pink/5 ml-auto" title="Delete segment">✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {phase === 'detecting' && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-gv-pink border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-sm text-gv-text-dim">Detecting scenes...</p>
          </div>
        </div>
      )}

      {phase === 'annotating' && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="animate-spin w-10 h-10 border-3 border-gv-pink border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-base font-medium text-gv-text">Annotating...</p>
            <p className="text-sm text-gv-text-dim mt-1">{pipelinePhase ? <span className="text-gv-pink">{pipelinePhase}</span> : 'Starting pipeline...'}</p>
            <div className="mt-4 bg-gv-bg-deep rounded-full h-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-gv-pink to-gv-green rounded-full transition-all duration-500" style={{ width: `${Math.max(5, annotationProgress)}%` }} /></div>
            <div className="mt-4 space-y-1 text-xs text-gv-text-dim">{allSegments.filter(s => s.status === 'completed' || s.status === 'partial_completed').length} / {allSegments.length} segments done</div>
            <div className="flex flex-wrap gap-1 mt-2">{allSegments.map(s => (<span key={`${s.videoId}_${s.segmentId}`} className={`w-3 h-3 rounded ${s.status === 'completed' ? 'bg-gv-green-deep' : s.status === 'partial_completed' ? 'bg-gv-gold' : s.status === 'processing' ? 'bg-gv-gold animate-pulse' : s.status === 'failed' ? 'bg-gv-pink' : 'bg-gv-border'}`} />))}</div>
          </div>
        </div>
      )}

      {phase === 'completed' && (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[45%] min-w-[400px] flex flex-col border-r border-gv-border/50">
            {selectedVideo && <div className="flex-shrink-0"><VideoPlayer
              src={`/api/video-annotation/files/${selectedVideo.videoId}`}
              startTime={selectedSegment?.start || 0}
              currentTime={selectedFrame?.timestamp}
              fps={selectedVideo.fps || 30}
              frameTimes={activeAnnotation?.frames?.map(frame => frame.timestamp)}
              onFrameSeek={handleFrameSeek}
            /></div>}
            <div className="flex-shrink-0 bg-gv-surface border-t border-gv-border/50 px-3 py-1.5 flex items-center gap-2">
              {allSegments.length > 0 && (
                <button onClick={() => setViewMode(null)} className="px-2 py-0.5 rounded text-xs bg-gv-bg text-gv-text-dim hover:bg-gv-pink/10">← Segments</button>
              )}
              <span className="flex-1" />
              {selectedSegment && selectedVideoId && (
                <>
                  <button
                    onClick={() => handleAnnotateSegment(selectedVideoId, selectedSegment, 'precision')}
                    disabled={annotatingSegments.has(`${selectedVideoId}_${selectedSegment.segmentId}`) || workerStatus !== 'ok'}
                    className="px-2 py-0.5 rounded text-xs bg-gv-pink/10 text-gv-pink hover:bg-gv-pink/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('video.precision_locate_title')}
                  >
                     {t('video.precision_locate')}
                  </button>
                  <button
                    onClick={() => handleAnnotateSegment(selectedVideoId, selectedSegment)}
                    disabled={annotatingSegments.has(`${selectedVideoId}_${selectedSegment.segmentId}`)}
                    className="px-2 py-0.5 rounded text-xs bg-gv-green/20 text-gv-green-deep hover:bg-gv-green/30 disabled:opacity-50 mr-1"
                    title="Re-annotate current segment"
                  >
                    Re-run Segment
                  </button>
                </>
              )}
              <button onClick={handleAnnotateAll} className="px-3 py-1 rounded text-xs font-medium bg-gv-green/20 text-gv-green-deep hover:bg-gv-green/30" title="Re-annotate all segments">Re-run All</button>
            </div>
            <div className="p-1.5 flex gap-1 overflow-x-auto bg-gv-surface flex-shrink-0 border-t border-gv-border/30">
              {allSegments.map(seg => (
                <button key={`${seg.videoId}_${seg.segmentId}`} onClick={() => {
                  setSelectedVideoId(seg.videoId)
                  setSelectedSegmentId(seg.segmentId)
                  setSelectedFrameIndex(null)
                  setSelectedTrackId(null)
                  setSelectedEntityType(null)
                  setCanvasMode('view')
                }}
                  className={`flex-shrink-0 px-2 py-0.5 rounded text-xs transition-colors ${selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId ? 'bg-gv-pink/20 text-gv-pink font-medium' : 'bg-gv-bg text-gv-text-dim hover:bg-gv-bg-deep'}`}>S{seg.segmentId}</button>
              ))}
            </div>
            {selectedVideo && selectedSegment && (
              <div className="flex-1 overflow-auto p-2 min-h-0">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gv-text-muted">
                  <span>{selectedFrame ? `Frame ${selectedFrame.frameIndex} · ${selectedFrame.timestamp.toFixed(3)}s` : 'No frame selected'}</span>
                  {selectedFrame && (
                    <span>
                      Current frame: {visibleFramePersonCount} people · {visibleFrameObjectCount} objects · {visibleFrameOcrCount} OCR
                      {' · '}
                      Segment: {segmentPersonTrackCount} people · {segmentObjectTrackCount} objects · {segmentOcrTrackCount} OCR
                    </span>
                  )}
                  {!activeAnnotation?.frames?.length && activeAnnotation && (
                    <span className="rounded bg-gv-gold/10 px-2 py-0.5 text-gv-gold-dark">Legacy segment box · edit creates a frame record</span>
                  )}
                  <span className="flex-1" />
                  {selectedFrame && <button
                    type="button"
                    onClick={() => void handleExportCurrentFrame()}
                    title="Exports people and non-OCR objects visible in this selected sampled frame."
                    className="rounded bg-gv-bg px-2 py-1 text-gv-text-dim hover:bg-gv-pink/10"
                  >Export Current Frame JSON</button>}
                  {spatialSaveStatus !== 'idle' && (
                    <span className={spatialSaveStatus === 'failed' ? 'text-gv-pink' : spatialSaveStatus === 'saved' ? 'text-gv-green-deep' : ''}>
                      {spatialSaveStatus === 'saving' ? 'Saving…' : spatialSaveStatus === 'saved' ? 'Saved' : 'Save failed'}
                    </span>
                  )}
                </div>
                {canvasMode === 'draw' && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-gv-border bg-gv-surface p-2 text-xs">
                    <span className="text-gv-text-muted">Choose label:</span>
                    <button type="button" disabled={spatialSaveStatus === 'saving'} onClick={() => setDrawEntityType('person')} className={`rounded px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${drawEntityType === 'person' ? 'bg-gv-pink/15 text-gv-pink' : 'bg-gv-bg text-gv-text-dim'}`}>Person</button>
                    <button type="button" disabled={spatialSaveStatus === 'saving'} onClick={() => setDrawEntityType('object')} className={`rounded px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${drawEntityType === 'object' ? 'bg-gv-pink/15 text-gv-pink' : 'bg-gv-bg text-gv-text-dim'}`}>Object</button>
                    {drawEntityType === 'object' && <input autoFocus value={drawObjectName} onChange={event => setDrawObjectName(event.target.value)} placeholder="Required object label" className="min-w-40 rounded border border-gv-border bg-gv-bg px-2 py-1 text-gv-text" />}
                    {drawEntityType === null && <span className="text-gv-gold-dark">Select a type before drawing.</span>}
                    {drawEntityType === 'object' && !drawObjectName.trim() && <span className="text-gv-gold-dark">Enter an object label.</span>}
                  </div>
                )}
                {selectedFrame && <AnnotationCanvas
                  imageUrl={`/api/video-annotation/files/${selectedVideo.videoId}?frame=${selectedFrame.frameIndex}&fps=${selectedVideo.fps || 30}&t=${selectedFrame.timestamp}`}
                  persons={displayPersons}
                  objects={displayObjects}
                  imgWidth={selectedFrame.imageWidth || selectedVideo.width || 1920}
                  imgHeight={selectedFrame.imageHeight || selectedVideo.height || 1080}
                  mode={canvasMode}
                  drawEnabled={spatialSaveStatus !== 'saving' && (
                    drawEntityType === 'person' || (drawEntityType === 'object' && Boolean(drawObjectName.trim()))
                  )}
                  hiddenTrackKeys={activePendingTrackKeys}
                  onModeChange={handleCanvasModeChange}
                  onDrawBox={handleDrawBox}
                  onSelectTrack={(trackId, entityType) => { setSelectedTrackId(trackId); setSelectedEntityType(entityType) }}
                  onResizeBox={handleResizeBox}
                  selectedTrackId={selectedTrackId}
                  selectedEntityType={selectedEntityType}
                />}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-[350px] flex flex-col overflow-auto p-4">
            {(!activeAnnotation && selectedSegment) ? (
              <div className="text-sm text-gv-text-dim space-y-4">
                <div className="p-4 rounded-lg border border-gv-gold/30 bg-gv-gold/5">
                  <p className="font-medium text-gv-gold-dark mb-1">Partial annotation</p>
                  <p className="text-xs text-gv-text-muted">{(selectedSegment as unknown as Record<string,string>).error || 'Some pipeline phases failed.'}</p>
                  <p className="text-xs text-gv-text-muted mt-2">Switch to <strong>Draw</strong> mode to add boxes manually, or edit JSON below.</p>
                </div>
                <JsonEditor
                  annotation={{ segmentId: selectedSegment.segmentId, start: selectedSegment.start, end: selectedSegment.end, scene: { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } }, camera: { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' }, persons: [], objects: [], events: [] }}
                  segmentMetadata={{ segmentId: selectedSegment.segmentId, start: selectedSegment.start, end: selectedSegment.end }}
                  onSave={handleJsonSave}
                />
              </div>
            ) : activeAnnotation ? (
              <>
                {selectedSegment?.status === 'partial_completed' && (
                  <div className="mb-4 rounded-lg border border-gv-gold/30 bg-gv-gold/5 p-3">
                    <p className="text-sm font-medium text-gv-gold-dark">{t('video.degraded_result')}</p>
                    <p className="mt-1 text-xs text-gv-text-muted">{pipelineErrors[0] || t('video.degraded_result_desc')}</p>
                  </div>
                )}
                {selectedTrackId !== null && selectedEntityType !== null && activeAnnotation && (
                  <TrackReviewEditor
                    key={`${selectedVideoId}_${selectedSegmentId}_${selectedFrame?.frameIndex}_${selectedEntityType}_${selectedTrackId}_${selectedFrame?.observations.find(observation => (
                      observation.trackId === selectedTrackId
                      && observation.entityType === selectedEntityType
                    ))?.className || ''}_${JSON.stringify(
                      selectedEntityType === 'person'
                        ? activeAnnotation.persons?.find(item => item.trackId === selectedTrackId)
                        : activeAnnotation.objects?.find(item => item.trackId === selectedTrackId)
                      || null,
                    )}`}
                    annotation={activeAnnotation}
                    selectedTrackId={selectedTrackId}
                    selectedEntityType={selectedEntityType}
                    selectedFrameIndex={selectedFrame?.frameIndex ?? 0}
                    selectedFrameLabel={selectedFrame?.observations.find(observation => (
                      observation.trackId === selectedTrackId
                      && observation.entityType === selectedEntityType
                    ))?.className}
                    selectedSourceLabels={selectedObjectSourceLabels}
                    onAnalyzePerson={handleAnalyzeSelectedPerson}
                    onDelete={handleDeleteTrack}
                    onSave={handleSaveEdits}
                    onConvert={handleConvertEntityType}
                  />
                )}
                <TextContent
                  key={`${selectedVideoId}_${selectedSegmentId}_${selectedSegment?.workerJobId || 'saved'}`}
                  objects={activeAnnotation.objects || []}
                  events={activeAnnotation.events || []}
                  speechTranscript={activeAnnotation.speechTranscript}
                  recognition={recognitionStatus}
                  pipelineErrors={pipelineErrors}
                  completed={selectedSegment?.status === 'completed' || selectedSegment?.status === 'partial_completed'}
                  onSave={handleSaveTextContent}
                />
                <SegmentReviewEditor
                  key={`${selectedVideoId}_${selectedSegmentId}_${JSON.stringify([
                    activeAnnotation.scene,
                    activeAnnotation.camera,
                    visualEventsFor(activeAnnotation),
                  ])}`}
                  annotation={activeAnnotation}
                  onSave={handleSaveSegEdits}
                />
                <JsonEditor
                  annotation={activeAnnotation}
                  segmentMetadata={{ segmentId: selectedSegment.segmentId, start: selectedSegment.start, end: selectedSegment.end }}
                  onSave={handleJsonSave}
                />
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-gv-text-dim text-sm">Select a segment to view annotations</div>
            )}
          </div>
        </div>
      )}

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={() => setShowUpload(false)}>
          <div className="glass-raised rounded-xl w-full max-w-2xl mx-4 p-6" onClick={event => event.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gv-text mb-1">{t('video.upload_title')}</h2>
            <p className="text-sm text-gv-text-dim mb-5">{t('video.upload_desc')}</p>
            <VideoBatchUploader
              onFiles={files => {
                setShowUpload(false)
                void handleUpload(files)
              }}
            />
            <div className="flex justify-end mt-5">
              <button onClick={() => setShowUpload(false)} className="btn-outline rounded-lg px-4 py-2 text-sm">{t('app.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      <ExportDialog
        open={showExport}
        onClose={() => { if (!exporting) setShowExport(false) }}
        onExport={handleExport}
        busy={exporting}
        busyText={t('video.generating_summary')}
      />
      <ExportDialog
        open={showSegmentExport}
        onClose={() => { if (!exporting) setShowSegmentExport(false) }}
        onExport={(_format, options) => handleExportCurrentSegment(options)}
        busy={exporting}
        busyText={t('video.generating_summary')}
        jsonOnly
        title="Export Current Segment JSON"
        description="Choose whether to include corrected OCR and speech transcript content."
      />
      <UndoToast
        toasts={toasts}
        onUndo={undoDeleteTrack}
        onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))}
      />
      </main>
    </div>
  )
}
