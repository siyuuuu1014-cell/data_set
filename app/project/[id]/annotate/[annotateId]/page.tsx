'use client'

import { useParams, useSearchParams } from 'next/navigation'
import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useStore } from '@/services/store'
import Link from 'next/link'
import { VideoPlayer } from '@/components/video-annotation/VideoPlayer'
import { FrameTrackList } from '@/components/video-annotation/FrameTrackList'
import { TrackEditor } from '@/components/video-annotation/TrackEditor'
import { SceneCameraEditor } from '@/components/video-annotation/SceneCameraEditor'
import { JsonEditor } from '@/components/video-annotation/JsonEditor'
import { TextContent, type TextContentEdits } from '@/components/video-annotation/TextContent'
import { UndoToast, type UndoToastItem } from '@/components/video-annotation/UndoToast'
import { VideoBatchUploader } from '@/components/video-annotation/VideoBatchUploader'
import { ExportDialog } from '@/components/video-annotation/ExportDialog'
import { IdentityManager } from '@/components/video-annotation/IdentityManager'
import { TimelineEditor } from '@/components/video-annotation/TimelineEditor'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { useConfirm } from '@/components/ui'
import { useLang } from '@/services/i18n'
import styles from './annotation-workbench.module.css'
import {
  downloadAsFile,
  exportCurrentFrameJson,
  exportCustomJson,
  downloadYoloZip,
  exportCoco,
  invalidVideoDimensions,
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
  mergeSegmentAnnotationFromServer,
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
  AnnotationExecutionMode, FrameAnnotation, SpatialEntityType, PersonAnalysisResult, ReviewStatus,
} from '@/services/video-annotation/types'

type PagePhase = 'no_videos' | 'uploading' | 'ready_uploaded' | 'detecting' | 'segments_pending' | 'annotating' | 'completed'
type InspectorPanel = 'object' | 'scene' | 'text' | 'json' | 'identity' | 'timeline'

const DEFAULT_SPLIT_RATIO = 70
const SPLIT_HANDLE_WIDTH = 12
const MIN_PRIMARY_PANE_WIDTH = 480
const MIN_SECONDARY_PANE_WIDTH = 496
const SPLIT_PREFERENCE_KEY = 'nuwa:annotation-workbench-split'

function splitRatioBounds(containerWidth: number): { min: number; max: number } {
  const availableWidth = Math.max(1, containerWidth - SPLIT_HANDLE_WIDTH)
  return {
    min: Math.min(50, (MIN_PRIMARY_PANE_WIDTH / availableWidth) * 100),
    max: Math.max(50, 100 - (MIN_SECONDARY_PANE_WIDTH / availableWidth) * 100),
  }
}

function clampSplitRatio(ratio: number, containerWidth: number): number {
  const { min, max } = splitRatioBounds(containerWidth)
  return Math.round(Math.min(max, Math.max(min, ratio)) * 10) / 10
}

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
  const { t } = useLang()
  const confirmAction = useConfirm()
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
            ? t('annotation.person_title', personDisplayId((edits as PersonAnnotation).personId, selectedTrackId))
            : t('annotation.object_track_title', selectedTrackId)}
          {'gender' in edits && (
            <span className="ml-2 text-xs text-gv-text-muted font-normal">
              ({t('annotation.segment_track', selectedTrackId)})
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
          title={t('annotation.delete_track')}
        >
          {t('annotation.delete')}
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
              {analysisStatus === 'running' ? t('annotation.analyzing_person') : t('annotation.analyze_person')}
            </button>
            <span className="text-xs text-gv-text-muted">
              {t('annotation.analysis_preview_desc')}
            </span>
          </div>
          {analysisResult && (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-gv-text-muted">
                {t('annotation.analysis_source', analysisResult.source === 'remote_api' ? 'Remote API' : 'Local Qwen', analysisResult.timestamp.toFixed(3))}
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
                {t('annotation.fill_empty_fields')}
              </button>
              <p className="text-gv-gold-dark">{t('annotation.review_then_save')}</p>
            </div>
          )}
          {analysisError && <p className="mt-2 text-xs text-gv-pink">{analysisError}</p>}
        </div>
      )}
      <div className="mt-3 border-t border-gv-border/60 pt-3">
        <p className="mb-2 text-sm font-medium text-gv-text">
          {t('annotation.convert_type', selectedEntityType === 'person' ? t('annotation.person_to_object') : t('annotation.object_to_person'))}
        </p>
        {selectedEntityType === 'person' && (
          <input
            value={conversionLabel}
            onChange={event => setConversionLabel(event.target.value)}
            placeholder={t('video.object_label_required')}
            aria-label={t('video.object_label_required')}
            className="mb-2 w-full rounded border border-gv-border bg-gv-bg px-2 py-1.5 text-sm text-gv-text"
          />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={selectedEntityType === 'person' && !conversionLabel.trim()}
            onClick={() => onConvert('frame', selectedEntityType === 'person' ? 'object' : 'person', conversionLabel)}
            className="rounded bg-gv-green/20 px-2 py-1 text-xs text-gv-green-deep hover:bg-gv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('annotation.convert_frame')}
          </button>
          <button
            type="button"
            disabled={selectedEntityType === 'person' && !conversionLabel.trim()}
            onClick={async () => {
              if (await confirmAction(t('annotation.convert_track_confirm', selectedEntityType === 'person' ? t('video.person_label') : t('video.object_label')))) {
                onConvert('track', selectedEntityType === 'person' ? 'object' : 'person', conversionLabel)
              }
            }}
            className="rounded bg-gv-gold/15 px-2 py-1 text-xs text-gv-gold-dark hover:bg-gv-gold/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('annotation.convert_track')}
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
  const { t } = useLang()
  const [scene, setScene] = useState<SceneAnnotation>(() => deepClone(annotation.scene || defaultScene()))
  const [camera, setCamera] = useState<CameraAnnotation>(() => deepClone(annotation.camera || defaultCamera()))
  const [events, setEvents] = useState<EventAnnotation[]>(() => deepClone(visualEventsFor(annotation)))
  const [dirty, setDirty] = useState(false)

  return (
    <div className="mb-4 p-3 rounded-lg border border-gv-border bg-gv-surface">
      <h4 className="text-sm font-semibold text-gv-text mb-2">{t('annotation.scene_camera_title')}</h4>
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
  const confirmAction = useConfirm()
  const { id: routeProjectId, annotateId, videoId: routeVideoId } = useParams<{ id?: string; annotateId: string; videoId?: string }>()
  const searchParams = useSearchParams()
  const routeSegmentId = Number(searchParams.get('segment'))
  const { updateAnnotateSet } = useStore()

  const [set, setSet] = useState<AnnotateSet | null>(null)
  const id = routeProjectId || set?.projectId || ''
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [viewMode, setViewMode] = useState<'completed' | null>(null)
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null)
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null)
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO)
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  const splitGridRef = useRef<HTMLDivElement | null>(null)
  const splitRatioRef = useRef(DEFAULT_SPLIT_RATIO)
  const preferredSplitRatioRef = useRef(DEFAULT_SPLIT_RATIO)
  const resizingSplitRef = useRef(false)

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SPLIT_PREFERENCE_KEY)
    if (storedValue === null) return
    const storedRatio = Number(storedValue)
    if (!Number.isFinite(storedRatio)) return
    const containerWidth = splitGridRef.current?.getBoundingClientRect().width || window.innerWidth
    const nextRatio = clampSplitRatio(storedRatio, containerWidth)
    preferredSplitRatioRef.current = storedRatio
    splitRatioRef.current = nextRatio
    setSplitRatio(nextRatio)
  }, [])

  const updateSplitRatio = useCallback((ratio: number, persist = false) => {
    const containerWidth = splitGridRef.current?.getBoundingClientRect().width || window.innerWidth
    const nextRatio = clampSplitRatio(ratio, containerWidth)
    preferredSplitRatioRef.current = nextRatio
    splitRatioRef.current = nextRatio
    setSplitRatio(nextRatio)
    if (persist) window.localStorage.setItem(SPLIT_PREFERENCE_KEY, String(nextRatio))
  }, [])

  const handleSplitPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia('(min-width: 1141px)').matches) return
    resizingSplitRef.current = true
    setIsResizingSplit(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [])

  const handleSplitPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingSplitRef.current || !splitGridRef.current) return
    const rect = splitGridRef.current.getBoundingClientRect()
    const availableWidth = Math.max(1, rect.width - SPLIT_HANDLE_WIDTH)
    updateSplitRatio(((event.clientX - rect.left) / availableWidth) * 100)
    event.preventDefault()
  }, [updateSplitRatio])

  const finishSplitResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingSplitRef.current) return
    resizingSplitRef.current = false
    setIsResizingSplit(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.localStorage.setItem(SPLIT_PREFERENCE_KEY, String(preferredSplitRatioRef.current))
  }, [])

  const handleSplitKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 2
    let nextRatio: number | null = null
    if (event.key === 'ArrowLeft') nextRatio = splitRatioRef.current - step
    if (event.key === 'ArrowRight') nextRatio = splitRatioRef.current + step
    if (event.key === 'Home') nextRatio = splitRatioBounds(splitGridRef.current?.getBoundingClientRect().width || window.innerWidth).min
    if (event.key === 'End') nextRatio = splitRatioBounds(splitGridRef.current?.getBoundingClientRect().width || window.innerWidth).max
    if (nextRatio === null) return
    event.preventDefault()
    updateSplitRatio(nextRatio, true)
  }, [updateSplitRatio])

  const resetSplitRatio = useCallback(() => {
    updateSplitRatio(DEFAULT_SPLIT_RATIO, true)
  }, [updateSplitRatio])

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
        setSelectedSegmentId(Number.isInteger(routeSegmentId) && firstVideo?.segments?.some(segment => segment.segmentId === routeSegmentId)
          ? routeSegmentId
          : firstVideo?.segments?.[0]?.segmentId ?? null)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [requestSet, routeVideoId, routeSegmentId])
  useEffect(() => { if (!set || !id) return; updateAnnotateSet(id, annotateId, set) }, [set, id, annotateId, updateAnnotateSet])

  const [transition, setTransition] = useState<'uploading' | 'detecting' | 'annotating' | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [canvasMode, setCanvasMode] = useState<'view' | 'draw'>('view')
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [selectedEntityType, setSelectedEntityType] = useState<SpatialEntityType | null>(null)
  const [inspectorPanel, setInspectorPanel] = useState<InspectorPanel>('object')
  const [segmentPreviewIndex, setSegmentPreviewIndex] = useState<number | null>(null)
  const [inspectorPreviewIndex, setInspectorPreviewIndex] = useState<number | null>(null)
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
  const [reviewSaving, setReviewSaving] = useState<ReviewStatus | null>(null)
  const [reviewError, setReviewError] = useState('')
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
    const allDone = hasSegments && vids.every(v => (v.segments || []).every(s => (
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
    const grid = splitGridRef.current
    if (!grid) return
    const observer = new ResizeObserver(() => {
      const nextRatio = clampSplitRatio(preferredSplitRatioRef.current, grid.getBoundingClientRect().width)
      splitRatioRef.current = nextRatio
      setSplitRatio(nextRatio)
    })
    observer.observe(grid)
    return () => observer.disconnect()
  }, [phase])

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
        } else {
          // Upload or metadata extraction failed — surface it instead of silently dropping the file
          setUploadProgress(prev => ({ ...prev, [file.name]: -1 }))
        }
      } catch { setUploadProgress(prev => ({ ...prev, [file.name]: -1 })) }
    }
    if (uploadedVideos.length > 0) {
      const res = await fetch(`/api/video-annotation/annotate-sets/${annotateId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos: [...(set.videos || []), ...uploadedVideos] }),
      })
      if (!res.ok) {
        console.error('[upload] failed to persist uploaded videos:', res.status)
      }
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
    if (!set || exporting) return false
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
        const invalid = invalidVideoDimensions(annotations)
        if (invalid.length > 0) {
          alert(t('video.export_invalid_dimensions', invalid.length))
        }
        await downloadYoloZip(annotations, `${set.name}_yolo_labels.zip`)
      } else if (format === 'coco') {
        const invalid = invalidVideoDimensions(annotations)
        if (invalid.length > 0) {
          alert(t('video.export_invalid_dimensions', invalid.length))
        }
        await downloadAsFile(exportCoco(annotations), `${set.name}_coco.json`)
      }
      return true
    } catch (error) {
      console.error('[video export] export failed', error)
      return false
    } finally {
      setExporting(false)
    }
  }, [set, scopedVideos, exporting, lang, t])

  const handleExportCurrentSegment = useCallback(async (options: CustomJsonExportOptions) => {
    if (!set || !selectedVideoId || selectedSegmentId == null || exporting) return false
    const video = (set.videos || []).find(item => item.videoId === selectedVideoId)
    const segment = video?.segments?.find(item => item.segmentId === selectedSegmentId)
    if (!video || !segment) return false

    const annotation = getEffectiveAnnotation(segment)
    if (!annotation) {
      return false
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
      return true
    } catch (error) {
      console.error('[video export] current segment export failed', error)
      return false
    } finally {
      setExporting(false)
    }
  }, [set, selectedVideoId, selectedSegmentId, exporting, lang, t])

  const persistAnnotationUpdates = useCallback((
    nextSet: AnnotateSet,
    videoId: string,
    updates: Array<{ segmentId: number; annotation: SegmentAnnotation }>,
  ) => {
    // Re-base on the freshest snapshot so a queued save never clobbers edits
    // from a newer in-flight save built from a stale closure.
    const base = setRef.current ?? nextSet
    const merged: AnnotateSet = {
      ...base,
      videos: (base.videos || []).map(v => {
        if (v.videoId !== videoId) return v
        return {
          ...v,
          segments: (v.segments || []).map(s => {
            const update = updates.find(u => u.segmentId === s.segmentId)
            return update ? { ...s, humanAnnotation: update.annotation } : s
          }),
        }
      }),
    }
    setRef.current = merged
    setSet(merged)
    updateAnnotateSet(id, annotateId, merged)
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
      // Merge instead of wholesale-replacing: a concurrent optimistic edit
      // (resize/delete made while this request was in flight) must survive.
      const localSet = setRef.current
      const serverVideo = payload.data.videos.find(v => v.videoId === videoId)
      const serverSegment = serverVideo?.segments.find(s => s.segmentId === segmentId)
      if (localSet && serverSegment) {
        const merged: AnnotateSet = {
          ...localSet,
          videos: (localSet.videos || []).map(v => {
            if (v.videoId !== videoId) return v
            return {
              ...v,
              segments: (v.segments || []).map(s => {
                if (s.segmentId !== segmentId) return s
                const localAnn = getEffectiveAnnotation(s)
                const serverAnn = getEffectiveAnnotation(serverSegment)
                if (!localAnn || !serverAnn) return s
                return {
                  ...s,
                  humanAnnotation: mergeSegmentAnnotationFromServer(localAnn, serverAnn),
                  nextManualTrackId: serverSegment.nextManualTrackId ?? s.nextManualTrackId,
                }
              }),
            }
          }),
        }
        setRef.current = merged
        setSet(merged)
        updateAnnotateSet(id, annotateId, merged)
      } else {
        setRef.current = payload.data
        setSet(payload.data)
        updateAnnotateSet(id, annotateId, payload.data)
      }
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

  const handleDeleteSegment = useCallback(async (segVideoId: string, segSegmentId: number) => {
    if (!set) return
    if (!await confirmAction({ message: t('video.delete_segment_confirm', segSegmentId), confirmLabel: t('app.delete'), tone: 'danger' })) return
    const prevSet = set
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
    try {
      const res = await fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[segment] delete failed', err)
      setSet(prevSet)
      updateAnnotateSet(id, annotateId, prevSet)
      alert(t('video.delete_segment_failed'))
    }
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet, t, confirmAction])

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
  const currentReviewStatus: ReviewStatus = selectedSegment?.reviewStatus || 'unreviewed'
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
    if (!await confirmAction(t(
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
    manualSplitSaving, t, annotateId, confirmAction,
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
      .filter(object => object._textContent || object.category?.trim().toLowerCase() === 'text')
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

  const handleFrameSeek = useCallback((timestamp: number, manual?: boolean) => {
    const frame = nearestFrame(activeAnnotation?.frames, timestamp)
    if (frame) setSelectedFrameIndex(frame.frameIndex)
    if (manual) {
      // Only user-initiated seeks leave the editing context; plain playback
      // must keep the current track selection so edits are not dropped.
      setSelectedTrackId(null)
      setSelectedEntityType(null)
      setCanvasMode('view')
    }
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
      throw new Error(t('annotation.select_segment_for_analysis'))
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
      throw new Error(apiErrorMessage(submitted, t('annotation.analysis_failed_http', response.status)))
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
        throw new Error(apiErrorMessage(statusPayload, t('annotation.analysis_status_failed_http', statusResponse.status)))
      }
      if (statusPayload.data.status === 'completed' && statusPayload.data.result) {
        return statusPayload.data.result
      }
      if (statusPayload.data.status === 'failed' || statusPayload.data.status === 'cancelled') {
        throw new Error(statusPayload.data.error || t('annotation.analysis_incomplete'))
      }
    }
    throw new Error(t('annotation.analysis_timeout'))
  }, [annotateId, selectedVideoId, selectedSegmentId, t])

  // ── Keyboard delete ────────────────────────────────

  useEffect(() => {
    if (selectedTrackId == null || selectedEntityType == null) return
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName || ''
      const editable = target?.isContentEditable || false
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag) && !editable) {
        e.preventDefault()
        handleDeleteTrack(selectedTrackId, selectedEntityType)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selectedTrackId, selectedEntityType, handleDeleteTrack])

  // Flush pending deletes when switching video or segment (not on frame step)
  const prevVideoSegRef = useRef(`${selectedVideoId || ''}_${selectedSegmentId ?? ''}`)
  useEffect(() => {
    const key = `${selectedVideoId || ''}_${selectedSegmentId ?? ''}`
    if (prevVideoSegRef.current !== key) {
      prevVideoSegRef.current = key
      flushPendingDeletes()
    }
  }, [selectedVideoId, selectedSegmentId, flushPendingDeletes])

  const handleReviewStatus = useCallback(async (status: 'needs_review' | 'approved' | 'rejected') => {
    if (!selectedVideo || !selectedSegment || reviewSaving) return
    setReviewSaving(status)
    setReviewError('')
    try {
      const response = await fetch(`/api/video-annotation/annotate-sets/${annotateId}/segments/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: selectedVideo.videoId, segmentId: selectedSegment.segmentId, status }),
      })
      const payload = await response.json().catch(() => null) as { data?: AnnotateSet; error?: { message?: string } } | null
      if (!response.ok || !payload?.data) throw new Error(payload?.error?.message || t('video.review_save_error'))
      setSet(payload.data)
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : t('video.review_save_error'))
    } finally {
      setReviewSaving(null)
    }
  }, [annotateId, selectedVideo, selectedSegment, reviewSaving, t])

  // ── Render ─────────────────────────────────────────

  if (loading) return (
    <div className={styles.stateShell}>
      <WorkspaceHeader />
      <main className={styles.routeState} role="status" aria-live="polite"><div><p>{t('annotation.loading')}</p></div></main>
    </div>
  )
  if (!set) return (
    <div className={styles.stateShell}>
      <WorkspaceHeader />
      <main className={styles.routeState}>
        <div><h1>{t('annotation.set_not_found')}</h1><p>{t('project.not_found_desc')}</p>
          <Link href="/annotations">{t('annotation.back')}</Link>
        </div>
      </main>
    </div>
  )
  if (routeVideoId && scopedVideos.length === 0) return (
    <div className={styles.stateShell}>
      <WorkspaceHeader />
      <main className={styles.routeState}>
        <div><h1>{t('video.video_not_found')}</h1><p>{t('state.not_found_desc')}</p>
          <Link href={`/annotations/${annotateId}`}>{t('video.back_to_project')}</Link>
        </div>
      </main>
    </div>
  )

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${routeVideoId ? styles.formalWorkbench : ''}`}>
      <WorkspaceHeader />
      <main
        className={`flex-1 flex flex-col min-h-0 ${styles.workbenchMain}`}
        aria-busy={phase === 'uploading' || phase === 'detecting' || phase === 'annotating'}
      >
      <div className={`flex items-center gap-4 px-4 py-3 border-b border-gv-border/50 bg-gv-surface ${styles.contextBar}`}>
        <Link href={routeVideoId ? `/annotations/${annotateId}` : '/annotations'} className={`text-gv-text-dim hover:text-gv-pink transition-colors ${styles.backButton}`} aria-label={routeVideoId ? t('video.back_to_project') : 'Back'}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Link>
        {routeVideoId ? (
          <div className={`flex-1 min-w-0 ${styles.contextCopy}`}>
            <p className="text-xs text-gv-text-muted truncate">{set.name}</p>
            <h1 className="text-lg font-semibold text-gv-text truncate">{selectedVideo?.fileName || set.name}</h1>
          </div>
        ) : (
          <h1 className="text-lg font-semibold text-gv-text flex-1 truncate">{set.name}</h1>
        )}
        <span className={styles.taskStatus} data-phase={phase}>
          <span aria-hidden="true" />
          {t(`video.task_phase.${phase}`)}
        </span>
        {!routeVideoId && (set.videos?.length || 0) > 0 && (
          <button
            onClick={() => setShowUpload(true)}
            disabled={transition === 'uploading'}
            className="btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            <svg className="mr-1 inline-block h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {t('video.add_videos')}
          </button>
        )}
        {allSegments.some(s => s.status === 'completed') && (
          <div className={styles.contextActionGroup} role="group" aria-label={t('video.export_group')}>
            {selectedSegmentId != null && (
              <button
                onClick={() => setShowSegmentExport(true)}
                disabled={exporting}
                title={t('video.export_current_segment_hint')}
                className="btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50"
              >
                {exporting ? t('video.generating_summary') : t('video.export_current_segment')}
              </button>
            )}
            <button onClick={() => setShowExport(true)} disabled={exporting} className={`btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${styles.primaryContextAction}`}>
              {t('video.export_all_annotations')}
            </button>
          </div>
        )}
      </div>

      {!routeVideoId && phase === 'no_videos' && (
        <div className={`flex-1 flex items-center justify-center p-8 ${styles.setupViewport}`}>
          <div className="w-full max-w-2xl">
            <h2 className="text-lg font-semibold text-gv-text mb-2">{t('video.upload_workspace_title')}</h2>
            <p className="text-sm text-gv-text-dim mb-6">{t('video.upload_workspace_desc')}</p>
            <VideoBatchUploader onFiles={handleUpload} />
          </div>
        </div>
      )}

      {scopedVideos.length > 0 && allSegments.length === 0 && phase !== 'uploading' && phase !== 'detecting' && phase !== 'annotating' && (
        <div className={`flex-1 p-6 overflow-auto ${styles.setupViewport}`}>
          <div className={`max-w-4xl mx-auto ${styles.setupPanel}`}>
            <h2 className="text-lg font-semibold text-gv-text mb-4">{selectedVideo?.fileName || t('video.video_count', scopedVideos.length)}</h2>
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg border border-gv-border bg-gv-bg-deep">
              <span className="text-xs text-gv-text-dim shrink-0">{t('video.scene_sensitivity')}：</span>
              <input type="range" min="0.15" max="0.8" step="0.05" value={sceneThreshold} onChange={e => setSceneThreshold(parseFloat(e.target.value))} className="flex-1 accent-gv-pink h-2" aria-label={t('video.scene_sensitivity')} />
              <span className="text-xs text-gv-pink font-mono min-w-[3ch]">{sceneThreshold.toFixed(2)}</span>
              <span className="text-xs text-gv-text-muted">（{t('video.scene_sensitivity_hint')}）</span>
            </div>
            <div className="space-y-3">
              {scopedVideos.map(v => (
                <div key={v.videoId} className="card p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gv-text truncate">{v.fileName}</p>
                    <p className="text-xs text-gv-text-dim mt-0.5">{v.duration ? `${v.duration.toFixed(1)}s` : t('video.processing_video')}{v.width ? ` · ${v.width}×${v.height}` : ''}</p>
                  </div>
                  <button onClick={() => handleDetectScenes(v.videoId)} className="rounded-lg px-4 py-2 text-sm bg-gv-green/20 text-gv-green-deep hover:bg-gv-green/30 transition-colors font-medium">{t('video.detect_scenes')}</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {phase === 'uploading' && (
        <div className={`flex-1 flex items-center justify-center p-8 ${styles.centerState}`}>
          <div className="w-full max-w-md text-center">
            <div className="animate-spin w-8 h-8 border-2 border-gv-pink border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-sm text-gv-text-dim">{t('video.uploading_progress')}</p>
            {Object.entries(uploadProgress).map(([name, pct]) => (
              <div key={name} className="flex items-center gap-2 mt-2 text-xs text-gv-text-dim">
                <span className="truncate flex-1 text-left">{name}</span>
                <span className={`w-12 text-right ${pct < 0 ? 'text-gv-pink' : ''}`}>{pct < 0 ? t('video.upload_failed') : `${pct}%`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'segments_pending' && (
        <div
          ref={splitGridRef}
          className={`flex-1 flex overflow-hidden ${styles.workspaceGrid} ${isResizingSplit ? styles.isResizingSplit : ''}`}
          style={{ gridTemplateColumns: `minmax(${MIN_PRIMARY_PANE_WIDTH}px, ${splitRatio}fr) ${SPLIT_HANDLE_WIDTH}px minmax(${MIN_SECONDARY_PANE_WIDTH}px, ${100 - splitRatio}fr)` }}
        >
          <div id="annotation-primary-pane" className={`w-1/2 border-r border-gv-border/50 flex flex-col ${styles.previewColumn}`}>
            {selectedVideo && (
              <>
                <div className="flex-1 flex items-center justify-center p-4"><VideoPlayer
                  src={`/api/video-annotation/files/${selectedVideo.videoId}`}
                  startTime={selectedSegment?.start || 0}
                  currentTime={manualSplitMode && manualSplitTime != null ? manualSplitTime : undefined}
                  fps={selectedVideo.fps || 30}
                  onFrameSeek={handleSplitCursorSeek}
                /></div>
                <div className={`border-t border-gv-border/50 px-4 py-3 ${styles.splitTimeline}`}>
                  <div className="relative flex h-8 overflow-hidden rounded-lg border border-gv-border bg-gv-bg-deep/40">
                    {(selectedVideo.segments || []).map(segment => (
                      <button
                        key={segment.segmentId}
                        type="button"
                        title={`${t('video.segment_label', segment.segmentId)}：${formatSplitTime(segment.start)} - ${formatSplitTime(segment.end)}`}
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
                            ? 'bg-gv-pink/14'
                            : 'bg-gv-green/8 hover:bg-gv-green/14'
                        }`}
                      />
                    ))}
                    {manualSplitMode && manualSplitTime != null && selectedVideo.duration > 0 && (
                      <span
                        className={`pointer-events-none absolute inset-y-0 w-0.5 bg-gv-pink ${styles.splitCursor}`}
                        style={{ left: `${Math.min(100, Math.max(0, manualSplitTime / selectedVideo.duration * 100))}%` }}
                      />
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-gv-text-muted">
                    <span>{selectedSegment ? `${t('video.segment_label', selectedSegment.segmentId)}：${formatSplitTime(selectedSegment.start)} - ${formatSplitTime(selectedSegment.end)}` : t('video.manual_split_select_segment')}</span>
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
                <div className={`border-t border-gv-border/50 p-3 flex items-center justify-between ${styles.primaryActionBar}`}>
                  <span className="text-sm text-gv-text-dim truncate">{selectedVideo.fileName}</span>
                  {workerStatus === 'ok' && <button onClick={handleAnnotateAll} className="btn-primary rounded-lg px-4 py-2 text-sm">{t('video.annotate_all_segments')}</button>}
                </div>
              </>
            )}
          </div>
          <div
            className={styles.splitHandle}
            role="separator"
            aria-label="调整视频区域与片段列表的宽度"
            aria-controls="annotation-primary-pane annotation-secondary-pane"
            aria-orientation="vertical"
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(splitRatio)}
            aria-valuetext={`左侧 ${Math.round(splitRatio)}%，右侧 ${Math.round(100 - splitRatio)}%`}
            tabIndex={0}
            title="拖动调整左右宽度；双击恢复默认比例"
            onPointerDown={handleSplitPointerDown}
            onPointerMove={handleSplitPointerMove}
            onPointerUp={finishSplitResize}
            onPointerCancel={finishSplitResize}
            onKeyDown={handleSplitKeyDown}
            onDoubleClick={resetSplitRatio}
          >
            <span aria-hidden="true" />
          </div>
          <div id="annotation-secondary-pane" className={`w-1/2 flex flex-col overflow-auto p-4 ${styles.queueColumn}`}>
            <div className={styles.segmentQueueHeader}>
              <div className={styles.segmentQueueTitle}>
                <h3>{t('video.segments')} ({allSegments.length})</h3>
                {allSegments.filter(s => s.status === 'completed' || s.status === 'partial_completed').length > 0 && <span>{t('video.completed_segments', allSegments.filter(s => s.status === 'completed' || s.status === 'partial_completed').length)}</span>}
              </div>
              {selectedVideo && (
                <div className={styles.segmentQueueTools}>
                  <label className={styles.sceneThresholdControl}>
                    <span>{t('video.scene_threshold')}</span>
                    <input type="range" min="0.15" max="0.8" step="0.05" value={sceneThreshold} onChange={e => setSceneThreshold(parseFloat(e.target.value))} aria-label={t('video.scene_threshold')} />
                    <output>{sceneThreshold.toFixed(2)}</output>
                  </label>
                  <button type="button" onClick={() => handleDetectScenes(selectedVideo.videoId)} className={styles.queueToolButton} title={t('video.redetect_scenes')}>{t('video.redetect_scenes')}</button>
                  <button
                    type="button"
                    onClick={handleToggleManualSplit}
                    disabled={!manualSplitEligible || manualSplitSaving}
                    title={manualSplitEligible ? t('video.manual_split_title') : t('video.manual_split_draft_only')}
                    data-active={manualSplitMode || undefined}
                    className={styles.queueToolButton}
                  >
                    {t('video.manual_split_title')}
                  </button>
                </div>
              )}
            </div>
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
            <div className={styles.segmentList}>
              {allSegments.map(seg => (
                <div
                  key={`${seg.videoId}_${seg.segmentId}`}
                  className={`card p-3 flex items-center gap-3 transition-all ${styles.segmentItem} ${selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId ? 'border-gv-pink' : ''}`}
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
                  <div
                    className={styles.segmentStatusDot}
                    data-status={seg.status}
                    data-review-status={seg.reviewStatus || 'unreviewed'}
                    aria-hidden="true"
                  />
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
                    className={styles.segmentSummary}
                  >
                    <strong>{t('video.segment_label', seg.segmentId)}</strong>
                    <small title={`${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s (${seg.videoName})`}>
                      {seg.start.toFixed(1)}s - {seg.end.toFixed(1)}s ({seg.videoName})
                    </small>
                  </button>
                  <span className={styles.segmentPipelineStatus}>
                    {seg.status === 'processing' && seg.processingMode === 'precision'
                      ? t('video.precision_running')
                      : t(`video.status.${seg.status}`)}
                  </span>
                  {(seg.humanAnnotation || seg.modelAnnotation) && (
                    <span className={styles.segmentReviewBadge} data-status={seg.reviewStatus || 'unreviewed'}>
                      {t(`video.review_value.${seg.reviewStatus || 'unreviewed'}`)}
                    </span>
                  )}
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
                      <span className="text-xs text-gv-gold truncate max-w-[140px]" title={(seg as unknown as Record<string,string>).error}>{(seg as unknown as Record<string,string>).error || t('video.pipeline_error')}</span>
                      {((seg as unknown as Record<string,unknown>).modelAnnotation as Record<string,unknown>) && (
                        <button aria-label={t('video.review_partial_segment', seg.segmentId)} onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setSelectedFrameIndex(null); setSelectedTrackId(null); setSelectedEntityType(null); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-gold/10 text-gv-gold-dark hover:bg-gv-gold/20 ml-2">{t('video.review_degraded')}</button>
                      )}
                      <button aria-label={t('video.retry_segment', seg.segmentId)} onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20">{t('video.retry_degraded')}</button>
                    </>
                  )}
                  {seg.status === 'partial_completed' && (
                    <>
                      <button aria-label={t('video.review_partial_segment', seg.segmentId)} onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setSelectedFrameIndex(null); setSelectedTrackId(null); setSelectedEntityType(null); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-gold/10 text-gv-gold-dark hover:bg-gv-gold/20 ml-2">{t('video.review_degraded')}</button>
                      <button aria-label={t('video.rerun_segment', seg.segmentId)} onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20">{t('video.retry_degraded')}</button>
                    </>
                  )}
                  {seg.status === 'completed' && (
                    <>
                      <button aria-label={t('video.review_segment', seg.segmentId)} onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setSelectedFrameIndex(null); setSelectedTrackId(null); setSelectedEntityType(null); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-pink/10 text-gv-pink hover:bg-gv-pink/20 ml-2">{t('video.review_action')}</button>
                      <button aria-label={t('video.rerun_segment', seg.segmentId)} onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20" title={t('video.rerun_segment', seg.segmentId)}>{t('video.rerun_action')}</button>
                    </>
                  )}
                  {seg.status !== 'completed' && seg.status !== 'partial_completed' && seg.status !== 'processing' && seg.status !== 'failed' && workerStatus === 'ok' && (
                    <button aria-label={t('video.annotate_segment', seg.segmentId)} onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} disabled={annotatingSegments.has(`${seg.videoId}_${seg.segmentId}`)} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20 disabled:opacity-50 ml-2">
                      {annotatingSegments.has(`${seg.videoId}_${seg.segmentId}`) ? '...' : t('video.annotate_action')}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSegment(seg.videoId, seg.segmentId) }}
                    className="rounded px-2 py-0.5 text-xs text-gv-text-muted hover:text-gv-pink hover:bg-gv-pink/5 ml-auto"
                    aria-label={t('video.delete_segment', seg.segmentId)}
                    title={t('video.delete_segment', seg.segmentId)}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {phase === 'detecting' && (
        <div className={`flex-1 flex items-center justify-center p-8 ${styles.centerState}`}>
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-gv-pink border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-sm text-gv-text-dim">{t('annotation.detecting_scenes')}</p>
          </div>
        </div>
      )}

      {phase === 'annotating' && (
        <div className={`flex-1 flex items-center justify-center p-8 ${styles.centerState}`}>
          <div className="text-center max-w-md">
            <div className="animate-spin w-10 h-10 border-3 border-gv-pink border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-base font-medium text-gv-text">{t('annotation.annotating')}</p>
            <p className="text-sm text-gv-text-dim mt-1">{pipelinePhase ? <span className={styles.pipelinePhase}>{pipelinePhase}</span> : t('annotation.starting_pipeline')}</p>
            <div className={`mt-4 bg-gv-bg-deep rounded-full h-2 overflow-hidden ${styles.pipelineTrack}`}><div className={`h-full bg-gv-pink rounded-full transition-all duration-500 ${styles.pipelineProgress}`} style={{ width: `${Math.max(5, annotationProgress)}%` }} /></div>
            <div className="mt-4 space-y-1 text-xs text-gv-text-dim">{t('annotation.segments_done', allSegments.filter(s => s.status === 'completed' || s.status === 'partial_completed').length, allSegments.length)}</div>
            <div className="flex flex-wrap gap-1 mt-2">{allSegments.map(s => (<span key={`${s.videoId}_${s.segmentId}`} className={`w-3 h-3 rounded ${s.status === 'completed' ? 'bg-ui-secondary' : s.status === 'partial_completed' ? 'bg-gv-gold' : s.status === 'processing' ? 'bg-ui-icon-accent animate-pulse' : s.status === 'failed' ? 'bg-ui-danger' : 'bg-gv-border'}`} />))}</div>
          </div>
        </div>
      )}

      {phase === 'completed' && (
        <div
          ref={splitGridRef}
          className={`flex-1 flex overflow-hidden ${styles.editorGrid} ${isResizingSplit ? styles.isResizingSplit : ''}`}
          style={{ gridTemplateColumns: `minmax(${MIN_PRIMARY_PANE_WIDTH}px, ${splitRatio}fr) ${SPLIT_HANDLE_WIDTH}px minmax(${MIN_SECONDARY_PANE_WIDTH}px, ${100 - splitRatio}fr)` }}
        >
          <div id="annotation-primary-pane" className={`w-[45%] min-w-[400px] flex flex-col border-r border-gv-border/50 ${styles.canvasColumn}`}>
            {selectedVideo && <div className="flex-shrink-0"><VideoPlayer
              src={`/api/video-annotation/files/${selectedVideo.videoId}`}
              startTime={selectedSegment?.start || 0}
              currentTime={selectedFrame?.timestamp}
              fps={selectedVideo.fps || 30}
              frameTimes={activeAnnotation?.frames?.map(frame => frame.timestamp)}
              onFrameSeek={handleFrameSeek}
            /></div>}
            <div className={`flex-shrink-0 bg-gv-surface border-t border-gv-border/50 px-3 py-1.5 flex items-center gap-2 ${styles.canvasToolbar}`}>
              {allSegments.length > 0 && (
                <button onClick={() => setViewMode(null)} className="px-2 py-0.5 rounded text-xs bg-gv-bg text-gv-text-dim hover:bg-gv-pink/10 inline-flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t('video.back_to_segments')}
                </button>
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
                    title={t('video.rerun_current_segment')}
                  >
                    {t('video.rerun_current_segment')}
                  </button>
                </>
              )}
              <button onClick={handleAnnotateAll} className="px-3 py-1 rounded text-xs font-medium bg-gv-green/20 text-gv-green-deep hover:bg-gv-green/30" title={t('video.rerun_all_segments')}>{t('video.rerun_all_segments')}</button>
            </div>
            <div className={`p-1.5 flex gap-1 overflow-x-auto bg-gv-surface flex-shrink-0 border-t border-gv-border/30 ${styles.segmentTabs}`} aria-label={t('video.segment_directory')}>
              <div className={styles.segmentRailHeader}>
                <strong>{t('video.segments')}</strong>
                <span>{allSegments.length}</span>
              </div>
              <div
                className={styles.segmentTabOptions}
                style={{
                  '--segment-slide-index': segmentPreviewIndex ?? Math.max(0, allSegments.findIndex(seg => selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId)),
                } as CSSProperties}
                onPointerLeave={() => setSegmentPreviewIndex(null)}
              >
                <span className={styles.segmentSlideIndicator} aria-hidden="true" />
              {allSegments.map((seg, index) => (
                <button key={`${seg.videoId}_${seg.segmentId}`} onPointerEnter={() => setSegmentPreviewIndex(index)} onClick={() => {
                  setSelectedVideoId(seg.videoId)
                  setSelectedSegmentId(seg.segmentId)
                  setSelectedFrameIndex(null)
                  setSelectedTrackId(null)
                  setSelectedEntityType(null)
                  setCanvasMode('view')
                }}
                  aria-current={selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId ? 'true' : undefined}
                  data-status={seg.status}
                  data-review-status={seg.reviewStatus || 'unreviewed'}
                  title={`${t('video.review_status')}: ${t(`video.review_value.${seg.reviewStatus || 'unreviewed'}`)}`}
                  className={`flex-shrink-0 px-2 py-0.5 rounded text-xs transition-colors ${selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId ? 'bg-gv-pink/20 text-gv-pink font-medium' : 'bg-gv-bg text-gv-text-dim hover:bg-gv-bg-deep'}`}>
                  <strong>S{seg.segmentId}</strong>
                  <small>{formatSplitTime(seg.start)}–{formatSplitTime(seg.end)}</small>
                  <span aria-hidden="true" />
                </button>
              ))}
              </div>
            </div>
            {selectedVideo && selectedSegment && (
              <div className={`flex-1 overflow-auto p-2 min-h-0 ${styles.canvasWorkspace}`}>
                <div className={`mb-2 flex flex-wrap items-center gap-2 text-xs text-gv-text-muted ${styles.frameMeta}`}>
                  <span>{selectedFrame ? t('video.frame_label', selectedFrame.frameIndex, selectedFrame.timestamp.toFixed(3)) : t('video.no_frame_selected')}</span>
                  {selectedFrame && (
                    <span>
                      {t('video.current_frame_summary', visibleFramePersonCount, visibleFrameObjectCount, visibleFrameOcrCount)}
                      {' · '}
                      {t('video.segment_summary_counts', segmentPersonTrackCount, segmentObjectTrackCount, segmentOcrTrackCount)}
                    </span>
                  )}
                  {!activeAnnotation?.frames?.length && activeAnnotation && (
                    <span className="rounded bg-gv-gold/10 px-2 py-0.5 text-gv-gold-dark">{t('video.legacy_frame_hint')}</span>
                  )}
                  <span className="flex-1" />
                  {selectedFrame && <button
                    type="button"
                    onClick={() => void handleExportCurrentFrame()}
                    title={t('video.export_current_frame')}
                    className="rounded bg-gv-bg px-2 py-1 text-gv-text-dim hover:bg-gv-pink/10"
                  >{t('video.export_current_frame')}</button>}
                  {spatialSaveStatus !== 'idle' && (
                    <span className={spatialSaveStatus === 'failed' ? 'text-gv-pink' : spatialSaveStatus === 'saved' ? 'text-gv-green-deep' : ''}>
                      {spatialSaveStatus === 'saving' ? t('video.save_saving') : spatialSaveStatus === 'saved' ? t('video.save_saved') : t('video.save_failed')}
                    </span>
                  )}
                </div>
                {canvasMode === 'draw' && (
                  <div className={`mb-2 flex items-center gap-2 rounded-lg border border-gv-border bg-gv-surface p-2 text-xs ${styles.drawPanel}`}>
                    <span className="text-gv-text-muted">{t('video.choose_draw_label')}</span>
                    <button type="button" disabled={spatialSaveStatus === 'saving'} onClick={() => setDrawEntityType('person')} className={`rounded px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${drawEntityType === 'person' ? 'bg-gv-pink/15 text-gv-pink' : 'bg-gv-bg text-gv-text-dim'}`}>{t('video.person_label')}</button>
                    <button type="button" disabled={spatialSaveStatus === 'saving'} onClick={() => setDrawEntityType('object')} className={`rounded px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${drawEntityType === 'object' ? 'bg-gv-pink/15 text-gv-pink' : 'bg-gv-bg text-gv-text-dim'}`}>{t('video.object_label')}</button>
                    {drawEntityType === 'object' && <input autoFocus value={drawObjectName} onChange={event => setDrawObjectName(event.target.value)} placeholder={t('video.object_label_required')} aria-label={t('video.object_label_required')} className="min-w-40 rounded border border-gv-border bg-gv-bg px-2 py-1 text-gv-text" />}
                    {drawEntityType === null && <span className="text-gv-gold-dark">{t('video.select_draw_type')}</span>}
                    {drawEntityType === 'object' && !drawObjectName.trim() && <span className="text-gv-gold-dark">{t('video.enter_object_label')}</span>}
                  </div>
                )}
                {selectedFrame && <FrameTrackList
                  key={`${selectedVideo.videoId}:${selectedSegment.segmentId}:${selectedFrame.frameIndex}`}
                  imageUrl={`/api/video-annotation/files/${selectedVideo.videoId}?frame=${selectedFrame.frameIndex}&fps=${selectedVideo.fps || 30}&t=${selectedFrame.timestamp}`}
                  persons={displayPersons}
                  objects={displayObjects}
                  imgWidth={selectedFrame.imageWidth || selectedVideo.width || 1920}
                  imgHeight={selectedFrame.imageHeight || selectedVideo.height || 1080}
                  mode={canvasMode}
                  drawEnabled={spatialSaveStatus !== 'saving' && (
                    drawEntityType === 'person' || (drawEntityType === 'object' && Boolean(drawObjectName.trim()))
                  )}
                  pendingHiddenTrackKeys={activePendingTrackKeys}
                  onModeChange={handleCanvasModeChange}
                  onDrawBox={handleDrawBox}
                  onSelectTrack={(trackId, entityType) => {
                    setSelectedTrackId(trackId)
                    setSelectedEntityType(entityType)
                    setInspectorPanel('object')
                  }}
                  onResizeBox={handleResizeBox}
                  onDeleteTrack={handleDeleteTrack}
                  selectedTrackId={selectedTrackId}
                  selectedEntityType={selectedEntityType}
                />}
              </div>
            )}
          </div>
          <div
            className={styles.splitHandle}
            role="separator"
            aria-label="调整标注区域与审查面板的宽度"
            aria-controls="annotation-primary-pane annotation-secondary-pane"
            aria-orientation="vertical"
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(splitRatio)}
            aria-valuetext={`左侧 ${Math.round(splitRatio)}%，右侧 ${Math.round(100 - splitRatio)}%`}
            tabIndex={0}
            title="拖动调整左右宽度；双击恢复默认比例"
            onPointerDown={handleSplitPointerDown}
            onPointerMove={handleSplitPointerMove}
            onPointerUp={finishSplitResize}
            onPointerCancel={finishSplitResize}
            onKeyDown={handleSplitKeyDown}
            onDoubleClick={resetSplitRatio}
          >
            <span aria-hidden="true" />
          </div>
          <div id="annotation-secondary-pane" className={`flex-1 min-w-[350px] flex flex-col overflow-auto p-4 ${styles.inspectorColumn}`}>
            {(!activeAnnotation && selectedSegment) ? (
              <div className="text-sm text-gv-text-dim space-y-4">
                <div className="p-4 rounded-lg border border-gv-gold/30 bg-gv-gold/5">
                  <p className="font-medium text-gv-gold-dark mb-1">{t('annotation.partial_title')}</p>
                  <p className="text-xs text-gv-text-muted">{(selectedSegment as unknown as Record<string,string>).error || t('annotation.partial_failed')}</p>
                  <p className="text-xs text-gv-text-muted mt-2">{t('annotation.partial_hint')}</p>
                </div>
                <JsonEditor
                  annotation={{ segmentId: selectedSegment.segmentId, start: selectedSegment.start, end: selectedSegment.end, scene: { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } }, camera: { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' }, persons: [], objects: [], events: [] }}
                  segmentMetadata={{ segmentId: selectedSegment.segmentId, start: selectedSegment.start, end: selectedSegment.end }}
                  onSave={handleJsonSave}
                />
              </div>
            ) : activeAnnotation ? (
              <>
                <nav
                  className={styles.inspectorTabs}
                  aria-label={t('video.inspector_navigation')}
                  style={{
                    '--inspector-slide-index': inspectorPreviewIndex ?? (['object', 'scene', 'text', 'json', 'identity', 'timeline'] as InspectorPanel[]).indexOf(inspectorPanel),
                  } as CSSProperties}
                  onPointerLeave={() => setInspectorPreviewIndex(null)}
                >
                  <span className={styles.inspectorSlideIndicator} aria-hidden="true" />
                  {([
                    ['object', t('video.inspector.object')],
                    ['scene', t('video.inspector.scene')],
                    ['text', t('video.inspector.text')],
                    ['json', 'JSON'],
                    ['identity', t('video.inspector.identity')],
                    ['timeline', t('video.inspector.timeline')],
                  ] as const).map(([panel, label], index) => (
                    <button
                      type="button"
                      key={panel}
                      aria-pressed={inspectorPanel === panel}
                      onPointerEnter={() => setInspectorPreviewIndex(index)}
                      onClick={() => setInspectorPanel(panel)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>

                {selectedVideo && selectedSegment && (
                  <div className={`mb-3 rounded-lg border border-ui-border bg-ui-surface p-2 ${styles.reviewBar}`}>
                    <div className={styles.reviewActions}>
                      <span className="mr-auto text-xs text-gv-text-muted">
                        {t('video.review_status')}: <strong className="text-gv-text">
                          {reviewSaving ? t('video.review_saving') : t(`video.review_value.${currentReviewStatus}`)}
                        </strong>
                      </span>
                      <button type="button" aria-pressed={currentReviewStatus === 'needs_review'} disabled={reviewSaving !== null} onClick={() => void handleReviewStatus('needs_review')} className="rounded bg-gv-gold/10 px-2 py-1 text-xs text-gv-gold-dark">{t('video.review_needs_review')}</button>
                      <button type="button" aria-pressed={currentReviewStatus === 'approved'} disabled={reviewSaving !== null} onClick={() => void handleReviewStatus('approved')} className="rounded bg-gv-green/15 px-2 py-1 text-xs text-gv-green-deep">{t('video.review_approve')}</button>
                      <button type="button" aria-pressed={currentReviewStatus === 'rejected'} disabled={reviewSaving !== null} onClick={() => void handleReviewStatus('rejected')} className="rounded bg-gv-pink/10 px-2 py-1 text-xs text-gv-pink">{t('video.review_reject')}</button>
                    </div>
                    {reviewError && <p role="alert" className={styles.reviewError}>{reviewError}</p>}
                  </div>
                )}
                {selectedSegment?.status === 'partial_completed' && (
                  <div className="mb-4 rounded-lg border border-gv-gold/30 bg-gv-gold/5 p-3">
                    <p className="text-sm font-medium text-gv-gold-dark">{t('video.degraded_result')}</p>
                    <p className="mt-1 text-xs text-gv-text-muted">{pipelineErrors[0] || t('video.degraded_result_desc')}</p>
                  </div>
                )}

                <div className={styles.inspectorContent}>
                  {inspectorPanel === 'object' && (
                    selectedTrackId !== null && selectedEntityType !== null ? (
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
                    ) : (
                      <div className={styles.inspectorPrompt}>
                        <strong>{t('video.inspector_select_track')}</strong>
                        <span>{t('video.inspector_select_track_desc')}</span>
                      </div>
                    )
                  )}

                  {inspectorPanel === 'scene' && (
                    <SegmentReviewEditor
                      key={`${selectedVideoId}_${selectedSegmentId}_${JSON.stringify([
                        activeAnnotation.scene,
                        activeAnnotation.camera,
                        visualEventsFor(activeAnnotation),
                      ])}`}
                      annotation={activeAnnotation}
                      onSave={handleSaveSegEdits}
                    />
                  )}

                  {inspectorPanel === 'text' && (
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
                  )}

                  {inspectorPanel === 'json' && (
                    <JsonEditor
                      annotation={activeAnnotation}
                      segmentMetadata={{ segmentId: selectedSegment.segmentId, start: selectedSegment.start, end: selectedSegment.end }}
                      onSave={handleJsonSave}
                    />
                  )}

                  {inspectorPanel === 'identity' && selectedVideo && selectedSegment && (
                    <IdentityManager
                      embedded
                      annotateSetId={annotateId}
                      video={selectedVideo}
                      selectedSegmentId={selectedSegment.segmentId}
                      selectedTrackId={selectedEntityType === 'person' ? selectedTrackId : null}
                      onUpdate={task => {
                        setRef.current = task
                        setSet(task)
                      }}
                    />
                  )}

                  {inspectorPanel === 'timeline' && selectedVideo && selectedSegment && (
                    <TimelineEditor
                      key={`${selectedSegment.segmentId}:${selectedFrame?.frameIndex ?? 'mid'}`}
                      annotateSetId={annotateId}
                      video={selectedVideo}
                      segment={selectedSegment}
                      initialTime={selectedFrame?.timestamp ?? (selectedSegment.start + selectedSegment.end) / 2}
                      onUpdate={task => {
                        setRef.current = task
                        setSet(task)
                        setSelectedTrackId(null)
                        setSelectedEntityType(null)
                        setSelectedFrameIndex(null)
                      }}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className={`flex items-center justify-center h-full text-gv-text-dim text-sm ${styles.inspectorEmpty}`}>{t('annotation.inspector_empty')}</div>
            )}
          </div>
        </div>
      )}

      {showUpload && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center ${styles.modalOverlay}`} onClick={() => setShowUpload(false)}>
          <div className={`glass-raised rounded-xl w-full max-w-2xl mx-4 p-6 ${styles.modalPanel}`} onClick={event => event.stopPropagation()}>
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
        outputNames={{
          json: `${set.name}_annotations.json`,
          yolo: `${set.name}_yolo_labels.zip`,
          coco: `${set.name}_coco.json`,
        }}
      />
      <ExportDialog
        open={showSegmentExport}
        onClose={() => { if (!exporting) setShowSegmentExport(false) }}
        onExport={(_format, options) => handleExportCurrentSegment(options)}
        busy={exporting}
        busyText={t('video.generating_summary')}
        jsonOnly
        title={t('video.export_segment_title')}
        description={t('video.export_segment_desc')}
        outputNames={{
          json: `${selectedVideoId}_segment_${selectedSegmentId}.json`,
        }}
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
