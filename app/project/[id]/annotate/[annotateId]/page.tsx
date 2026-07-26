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
  exportCustomJson,
  downloadYoloZip,
  exportCoco,
  generateVideoDescription,
  generateSemanticVideoDescription,
} from '@/services/video-annotation/export-service'
import { visualEventsFor } from '@/services/video-annotation/visual-events'
import type {
  AnnotateSet, BBox, ExportFormat,
  SegmentState, VideoTaskItem, VideoAnnotation, SegmentAnnotation,
  PersonAnnotation, ObjectAnnotation, SceneAnnotation, CameraAnnotation, EventAnnotation,
  AnnotationExecutionMode
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

function TrackReviewEditor({
  annotation,
  selectedTrackId,
  onDelete,
  onSave,
}: {
  annotation: SegmentAnnotation
  selectedTrackId: number
  onDelete: (trackId: number) => void
  onSave: (updated: PersonAnnotation | ObjectAnnotation) => void
}) {
  const selected = annotation.persons?.find(item => item.trackId === selectedTrackId)
    || annotation.objects?.find(item => item.trackId === selectedTrackId)
  const [edits, setEdits] = useState<PersonAnnotation | ObjectAnnotation | null>(
    () => selected ? deepClone(selected) : null,
  )
  const [dirty, setDirty] = useState(false)

  if (!edits) return null

  return (
    <div className="mb-4 p-3 rounded-lg border border-gv-border bg-gv-surface">
      <h4 className="text-sm font-semibold text-gv-text mb-2 flex items-center justify-between">
        <span>
          Track {selectedTrackId}
          {('_className' in edits) && (
            <span className="ml-2 text-xs text-gv-text-muted font-normal">
              ({(edits as Record<string, unknown>)._className as string})
            </span>
          )}
        </span>
        <button
          onClick={() => onDelete(selectedTrackId)}
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
        onSave={() => { onSave(edits); setDirty(false) }}
        dirty={dirty}
        detectionConfidence={(edits as unknown as Record<string, unknown>)._detectionConfidence as number | undefined}
      />
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
  const hiddenTrackIds = useMemo(() => new Set<number>(), [])
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [workerStatus, setWorkerStatus] = useState<string>('checking')
  const [showExport, setShowExport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [annotatingSegments, setAnnotatingSegments] = useState<Set<string>>(new Set())
  const [selectedFailedSegments, setSelectedFailedSegments] = useState<Set<string>>(new Set())
  const [retryingSelected, setRetryingSelected] = useState(false)
  const [sceneThreshold, setSceneThreshold] = useState(0.4)
  const sceneThresholdRef = useRef(sceneThreshold)
  useEffect(() => { sceneThresholdRef.current = sceneThreshold }, [sceneThreshold])

  // ── Undo / pending delete ─────────────────────────
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set())
  const commitTimersRef = useRef<Map<number, { timer: ReturnType<typeof setTimeout>; videoId: string; segmentId: number }>>(new Map())
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

  const handleExport = useCallback(async (format: ExportFormat) => {
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
        await downloadAsFile(exportCustomJson(annotations), `${set.name}_annotations.json`)
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

  const handleExportCurrentSegment = useCallback(async () => {
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
        exportCustomJson(singleSegmentExport),
        `${video.videoId}_segment_${segment.segmentId}.json`,
      )
      if (summary.source === 'fallback') alert(t('video.export_summary_fallback'))
    } catch (error) {
      console.error('[video export] current segment export failed', error)
      alert(t('video.export_failed'))
    } finally {
      setExporting(false)
    }
  }, [set, selectedVideoId, selectedSegmentId, exporting, lang, t])

  const handleDrawBox = useCallback((box: BBox) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const seg = set.videos?.find(v => v.videoId === selectedVideoId)?.segments?.find(s => s.segmentId === selectedSegmentId)
    const ann = deepClone<SegmentAnnotation>(getEffectiveAnnotation(seg || { humanAnnotation: null, modelAnnotation: null }) || {
      segmentId: selectedSegmentId, start: 0, end: 0,
      scene: { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } },
      camera: { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' },
      persons: [], objects: [], events: [],
    })
    const newTrackId = Math.max(0, ...(ann.persons || []).map(p => p.trackId), 0) + 1
    ann.persons = [...(ann.persons || []), {
      trackId: newTrackId, personId: null,
      gender: 'unknown', ageGroup: 'unknown',
      hair: { color: 'unknown', style: 'unknown' },
      expression: 'unknown', pose: 'unknown', action: [],
      facing: 'unknown', occlusion: 0, clothing: [],
      bbox: box, depth: null, keypoints: [],
      _className: 'manual',
    } as PersonAnnotation]
    ann._humanEdited = true
    const newSet: AnnotateSet = {
      ...set,
      videos: (set.videos || []).map(v => {
        if (v.videoId !== selectedVideoId) return v
        return { ...v, segments: (v.segments || []).map(s => s.segmentId !== selectedSegmentId ? s : { ...s, humanAnnotation: ann }) }
      }),
    }
    setSet(newSet)
    updateAnnotateSet(id, annotateId, newSet)
    setSelectedTrackId(newTrackId)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

  const handleResizeBox = useCallback((trackId: number, newBox: BBox) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const newSet: AnnotateSet = {
      ...set,
      videos: (set.videos || []).map(v => {
        if (v.videoId !== selectedVideoId) return v
        return { ...v, segments: (v.segments || []).map(s => {
          if (s.segmentId !== selectedSegmentId) return s
          const origAnn = getEffectiveAnnotation(s)
          if (!origAnn) return s
          const ann = JSON.parse(JSON.stringify(origAnn)) as SegmentAnnotation
          ann.persons = (ann.persons || []).map(p => p.trackId === trackId ? { ...p, bbox: newBox } : p)
          ann.objects = (ann.objects || []).map(o => o.trackId === trackId ? { ...o, bbox: newBox } : o)
          ann._humanEdited = true
          return { ...s, humanAnnotation: ann }
        })}
      }),
    }
    setSet(newSet)
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

  const commitPendingDeleteRef = useRef<((trackId: number) => void) | null>(null)

  const handleDeleteTrack = useCallback((trackId: number) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return

    // Mark as pending — visually hidden but recoverable
    setPendingDeletes(prev => new Set(prev).add(trackId))
    setSelectedTrackId(null)

    // Schedule commit after 6s — uses ref to avoid stale closure
    const timer = setTimeout(() => {
      commitPendingDeleteRef.current?.(trackId)
    }, 6000)
    commitTimersRef.current.set(trackId, { timer, videoId: selectedVideoId, segmentId: selectedSegmentId! })

    // Show undo toast
    const toastId = ++toastCounterRef.current
    setToasts(prev => [...prev, { id: toastId, trackId, message: `已删除 Track #${trackId}` }])
  }, [set, selectedVideoId, selectedSegmentId])

  // commitPendingDelete: actually filters the track and persists
  const commitPendingDelete = useCallback((trackId: number) => {
    // Read videoId/segmentId before removing from map
    const entry = commitTimersRef.current.get(trackId)
    const vidId = entry?.videoId
    const segId = entry?.segmentId
    commitTimersRef.current.delete(trackId)
    setPendingDeletes(prev => {
      const next = new Set(prev)
      next.delete(trackId)
      return next
    })
    setToasts(prev => prev.filter(t => t.trackId !== trackId))

    const curSet = setRef.current
    if (!curSet || !vidId || segId == null) return
    const newSet: AnnotateSet = {
      ...curSet,
      videos: (curSet.videos || []).map(v => {
        if (v.videoId !== vidId) return v
        return { ...v, segments: (v.segments || []).map(s => {
          if (s.segmentId !== segId) return s
          const sourceAnnotation = getEffectiveAnnotation(s)
          if (!sourceAnnotation) return s
          const ann = deepClone(sourceAnnotation)
          ann.persons = (ann.persons || []).filter(p => p.trackId !== trackId)
          ann.objects = (ann.objects || []).filter(o => o.trackId !== trackId)
          ann._humanEdited = true
          return { ...s, humanAnnotation: { ...ann } }
        })}
      }),
    }
    setSet(newSet)
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [id, annotateId, updateAnnotateSet])

  useEffect(() => { commitPendingDeleteRef.current = commitPendingDelete }, [commitPendingDelete])

  const undoDeleteTrack = useCallback((trackId: number) => {
    // Cancel the pending commit
    const entry = commitTimersRef.current.get(trackId)
    if (entry) {
      clearTimeout(entry.timer)
      commitTimersRef.current.delete(trackId)
    }
    setPendingDeletes(prev => {
      const next = new Set(prev)
      next.delete(trackId)
      return next
    })
    setToasts(prev => prev.filter(t => t.trackId !== trackId))
    setSelectedTrackId(trackId)
  }, [])

  // Flush all pending deletes when switching segments
  const flushPendingDeletes = useCallback(() => {
    const trackIds = [...pendingDeletes]
    if (trackIds.length === 0) return
    for (const tid of trackIds) {
      const entry = commitTimersRef.current.get(tid)
      if (entry) { clearTimeout(entry.timer); commitTimersRef.current.delete(tid) }
      commitPendingDelete(tid)
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
    const newSet = { ...set }
    const vid = (newSet.videos || []).find(v => v.videoId === selectedVideoId)
    if (!vid) return
    const seg = (vid.segments || []).find(s => s.segmentId === selectedSegmentId)
    if (!seg) return
    const ann = deepClone(getEffectiveAnnotation(seg))
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
    seg.humanAnnotation = ann
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

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
    setSet(newSet)
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

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
    setSet(newSet)
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSet),
    }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

  const handleSaveEdits = useCallback((edits: PersonAnnotation | ObjectAnnotation) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const newSet = { ...set }
    const vid = (newSet.videos || []).find(v => v.videoId === selectedVideoId)
    if (!vid) return
    const seg = (vid.segments || []).find(s => s.segmentId === selectedSegmentId)
    if (!seg) return
    const ann = deepClone(getEffectiveAnnotation(seg))
    if (!ann) return
    if ('gender' in edits) {
      ann.persons = (ann.persons || []).map(p => p.trackId === edits.trackId ? edits as PersonAnnotation : p)
    } else {
      ann.objects = (ann.objects || []).map(o => o.trackId === edits.trackId ? edits as ObjectAnnotation : o)
    }
    ann._humanEdited = true
    seg.humanAnnotation = ann
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

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

  // Display arrays with pending deletes filtered out (track still exists in annotation, just visually hidden)
  const displayPersons = useMemo(() =>
    (activeAnnotation?.persons || []).filter(p => !pendingDeletes.has(p.trackId)),
    [activeAnnotation, pendingDeletes]
  )
  const displayObjects = useMemo(() =>
    (activeAnnotation?.objects || []).filter(o => !pendingDeletes.has(o.trackId)),
    [activeAnnotation, pendingDeletes]
  )

  // ── Keyboard delete ────────────────────────────────

  useEffect(() => {
    if (selectedTrackId == null) return
    const h = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        handleDeleteTrack(selectedTrackId)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selectedTrackId, handleDeleteTrack])

  // Flush pending deletes when switching video or segment
  const prevVideoSegRef = useRef(`${selectedVideoId || ''}_${selectedSegmentId ?? ''}`)
  useEffect(() => {
    const key = `${selectedVideoId || ''}_${selectedSegmentId ?? ''}`
    if (prevVideoSegRef.current !== key) {
      prevVideoSegRef.current = key
      flushPendingDeletes()
    }
  }, [selectedVideoId, selectedSegmentId, flushPendingDeletes])

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
              <button onClick={() => void handleExportCurrentSegment()} disabled={exporting} className="btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50">
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
                <div className="flex-1 flex items-center justify-center p-4"><VideoPlayer src={`/api/video-annotation/files/${selectedVideo.videoId}`} startTime={selectedSegment?.start || 0} /></div>
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
                <div key={`${seg.videoId}_${seg.segmentId}`} className={`card p-3 flex items-center gap-3 transition-all ${selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId ? 'border-gv-pink' : ''}`}>
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
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gv-text">Segment {seg.segmentId}</p>
                    <p className="text-xs text-gv-text-dim">{seg.start.toFixed(1)}s – {seg.end.toFixed(1)}s ({seg.videoName})</p>
                  </div>
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
                        <button onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-gold/10 text-gv-gold-dark hover:bg-gv-gold/20 ml-2">Review Partial</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20">Retry</button>
                    </>
                  )}
                  {seg.status === 'partial_completed' && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-gold/10 text-gv-gold-dark hover:bg-gv-gold/20 ml-2">{t('video.review_degraded')}</button>
                      <button onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20">{t('video.retry_degraded')}</button>
                    </>
                  )}
                  {seg.status === 'completed' && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-pink/10 text-gv-pink hover:bg-gv-pink/20 ml-2">Review</button>
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
            {selectedVideo && <div className="flex-shrink-0"><VideoPlayer src={`/api/video-annotation/files/${selectedVideo.videoId}`} startTime={selectedSegment?.start || 0} /></div>}
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
                <button key={`${seg.videoId}_${seg.segmentId}`} onClick={() => { setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId) }}
                  className={`flex-shrink-0 px-2 py-0.5 rounded text-xs transition-colors ${selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId ? 'bg-gv-pink/20 text-gv-pink font-medium' : 'bg-gv-bg text-gv-text-dim hover:bg-gv-bg-deep'}`}>S{seg.segmentId}</button>
              ))}
            </div>
            {selectedVideo && selectedSegment && (
              <div className="flex-1 overflow-auto p-2 min-h-0">
                <AnnotationCanvas imageUrl={`/api/video-annotation/files/${selectedVideo.videoId}?t=${(selectedSegment.start || 0) + 1}`} persons={displayPersons} objects={displayObjects} imgWidth={selectedVideo.width || 1920} imgHeight={selectedVideo.height || 1080} mode={canvasMode} hiddenTrackIds={hiddenTrackIds} onModeChange={setCanvasMode} onDrawBox={handleDrawBox} onSelectTrack={setSelectedTrackId} onResizeBox={handleResizeBox} selectedTrackId={selectedTrackId} />
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
                <JsonEditor annotation={{ segmentId: selectedSegment.segmentId, start: selectedSegment.start, end: selectedSegment.end, scene: { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } }, camera: { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' }, persons: [], objects: [], events: [] }} onSave={handleJsonSave} />
              </div>
            ) : activeAnnotation ? (
              <>
                {selectedSegment?.status === 'partial_completed' && (
                  <div className="mb-4 rounded-lg border border-gv-gold/30 bg-gv-gold/5 p-3">
                    <p className="text-sm font-medium text-gv-gold-dark">{t('video.degraded_result')}</p>
                    <p className="mt-1 text-xs text-gv-text-muted">{pipelineErrors[0] || t('video.degraded_result_desc')}</p>
                  </div>
                )}
                {selectedTrackId !== null && activeAnnotation && (
                  <TrackReviewEditor
                    key={`${selectedVideoId}_${selectedSegmentId}_${selectedTrackId}_${JSON.stringify(
                      activeAnnotation.persons?.find(item => item.trackId === selectedTrackId)
                      || activeAnnotation.objects?.find(item => item.trackId === selectedTrackId)
                      || null,
                    )}`}
                    annotation={activeAnnotation}
                    selectedTrackId={selectedTrackId}
                    onDelete={handleDeleteTrack}
                    onSave={handleSaveEdits}
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
                <JsonEditor annotation={activeAnnotation} onSave={handleJsonSave} />
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
      <UndoToast
        toasts={toasts}
        onUndo={undoDeleteTrack}
        onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))}
      />
      </main>
    </div>
  )
}
