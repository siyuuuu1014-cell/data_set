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
import { VideoBatchUploader } from '@/components/video-annotation/VideoBatchUploader'
import { ExportDialog } from '@/components/video-annotation/ExportDialog'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { useLang } from '@/services/i18n'
import { downloadAsFile, exportCustomJson, downloadYoloZip, exportCoco } from '@/services/video-annotation/export-service'
import type {
  AnnotateSet, BBox, ExportFormat,
  SegmentState, VideoTaskItem, VideoAnnotation, SegmentAnnotation,
  PersonAnnotation, ObjectAnnotation, SceneAnnotation, CameraAnnotation, EventAnnotation
} from '@/services/video-annotation/types'

type PagePhase = 'no_videos' | 'uploading' | 'ready_uploaded' | 'detecting' | 'segments_pending' | 'annotating' | 'completed'

function deepClone<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)) as T }

function hasRealData(human: SegmentAnnotation | null, model: SegmentAnnotation | null): boolean {
  if (!human) return false
  return (
    human.scene?.place?.type !== 'unknown' ||
    (human.persons || []).some(p => p.gender !== 'unknown' || (p.clothing || []).length > 0) ||
    human.camera?.angle !== 'unknown' ||
    (human.events || []).length > 0 ||
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

function generateVideoDescription(segs: SegmentAnnotation[]): string {
  if (segs.length === 0) return ''
  const ann = segs[0]
  const parts: string[] = []
  const place = ann.scene?.place
  if (place) {
    const tags = ann.scene?.tags || []
    const lighting = place.lighting && place.lighting !== 'unknown' ? place.lighting : null
    const type = place.type && place.type !== 'unknown' ? place.type.replace(/_/g, ' ') : (tags[0] || '')
    if (type) parts.push(lighting ? `${lighting} ${type}` : type)
  }
  for (const p of ann.persons || []) {
    const desc: string[] = []
    const gender = p.gender !== 'unknown' ? p.gender : null
    const age = p.ageGroup !== 'unknown' ? p.ageGroup : null
    if (gender || age) desc.push([gender, age].filter(Boolean).join(' '))
    const clothes = (p.clothing || [])
      .filter(c => c.type)
      .map(c => c.color !== 'unknown' ? `${c.color} ${c.type}` : c.type)
    if (clothes.length) desc.push(`wearing ${clothes.join(', ')}`)
    const actions = (p.action || []).filter(a => a)
    if (actions.length) desc.push(actions.join(', '))
    if (desc.length) parts.push(desc.join(' '))
  }
  const events = (ann.events || []).filter(e => e.type)
  if (events.length) parts.push(events.map(e => e.type).join(', '))
  return parts.length ? parts.join('. ') + '.' : ''
}

export default function AnnotateDetailPage() {
  const { t } = useLang()
  const { id: routeProjectId, annotateId, videoId: routeVideoId } = useParams<{ id?: string; annotateId: string; videoId?: string }>()
  const { updateAnnotateSet } = useStore()
  const mountedRef = useRef(false)

  const [set, setSet] = useState<AnnotateSet | null>(null)
  const id = routeProjectId || set?.projectId || ''
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [viewMode, setViewMode] = useState<'completed' | null>(null)

  const fetchSet = useCallback(async () => {
    try {
      const res = await fetch(`/api/video-annotation/annotate-sets/${annotateId}`)
      if (res.ok) {
        const { data } = await res.json()
        setSet(data)
      }
    } catch {}
    setLoading(false)
  }, [annotateId])

  useEffect(() => { mountedRef.current = true; fetchSet() }, [fetchSet])
  useEffect(() => { if (!mountedRef.current || !set || !id) return; updateAnnotateSet(id, annotateId, set) }, [set, id, annotateId, updateAnnotateSet])

  const [transition, setTransition] = useState<'uploading' | 'detecting' | 'annotating' | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null)
  const [canvasMode, setCanvasMode] = useState<'view' | 'draw'>('view')
  const [hiddenTrackIds, setHiddenTrackIds] = useState<Set<number>>(new Set())
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [pipelinePhase, setPipelinePhase] = useState('')
  const [workerStatus, setWorkerStatus] = useState<string>('checking')
  const [showExport, setShowExport] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [annotatingSegments, setAnnotatingSegments] = useState<Set<string>>(new Set())
  const [localEdits, setLocalEdits] = useState<PersonAnnotation | ObjectAnnotation | null>(null)
  const [editDirty, setEditDirty] = useState(false)
  const [segScene, setSegScene] = useState<SceneAnnotation | null>(null)
  const [segCamera, setSegCamera] = useState<CameraAnnotation | null>(null)
  const [segEvents, setSegEvents] = useState<EventAnnotation[]>([])
  const [segEditDirty, setSegEditDirty] = useState(false)
  const [sceneThreshold, setSceneThreshold] = useState(0.4)
  const sceneThresholdRef = useRef(sceneThreshold)
  sceneThresholdRef.current = sceneThreshold

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
    const allDone = vids.every(v => (v.segments || []).every(s => s.status === 'completed' || s.status === 'failed'))
    const someDone = vids.some(v => (v.segments || []).some(s => s.status === 'completed'))
    const isAnnotating = vids.some(v => (v.segments || []).some(s => s.status === 'processing'))
    if (isAnnotating) return 'annotating'
    if (viewMode === 'completed') return 'completed'
    if (allDone || someDone) return 'segments_pending'
    if (hasSegments) return 'segments_pending'
    return 'ready_uploaded'
  }, [set, scopedVideos, transition, viewMode])

  const allDone = useMemo(() => {
    if (!set) return false
    return scopedVideos.every(v => (v.segments || []).every(s => s.status === 'completed' || s.status === 'failed'))
  }, [set, scopedVideos])

  useEffect(() => { if (allDone) setViewMode(null) }, [allDone])

  useEffect(() => {
    if (!set) return
    if (phase !== 'completed' && phase !== 'segments_pending') return
    const firstVid = scopedVideos[0]
    if (!firstVid) return
    if (routeVideoId && selectedVideoId !== routeVideoId) setSelectedVideoId(routeVideoId)
    const selectedBelongsToVideo = firstVid.segments?.some(segment => segment.segmentId === selectedSegmentId)
    if (selectedVideoId === firstVid.videoId && selectedSegmentId != null && selectedBelongsToVideo) return
    const firstSeg = firstVid.segments?.[0]
    if (!firstSeg) return
    setSelectedVideoId(firstVid.videoId)
    setSelectedSegmentId(firstSeg.segmentId)
  }, [phase, set, scopedVideos, routeVideoId, selectedVideoId, selectedSegmentId])

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

  const handleAnnotateSegment = useCallback(async (videoId: string, seg: SegmentState) => {
    if (!set) return
    const key = `${videoId}_${seg.segmentId}`
    setAnnotatingSegments(prev => new Set(prev).add(key))
    try {
      const res = await fetch(`/api/video-annotation/segments/${seg.segmentId}/annotate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotateSetId: annotateId, videoId, start: seg.start, end: seg.end }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setAnnotatingSegments(prev => { const next = new Set(prev); next.delete(key); return next })
        alert(`Annotation failed: ${(err as Record<string,unknown>).error || res.status}`)
        return
      }
      setTimeout(() => fetchSet(), 1000)
    } catch (e) {
      setAnnotatingSegments(prev => { const next = new Set(prev); next.delete(key); return next })
      alert(`Cannot reach server: ${String(e)}`)
    }
  }, [set, annotateId, fetchSet])

  const handleAnnotateAll = useCallback(async () => {
    if (!set) return
    for (const vid of scopedVideos)
      for (const seg of vid.segments || [])
        await handleAnnotateSegment(vid.videoId, seg)
  }, [set, scopedVideos, handleAnnotateSegment])

  const handleExport = useCallback((format: ExportFormat) => {
    if (!set) return
    setShowExport(false)
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
    if (format === 'json') downloadAsFile(exportCustomJson(annotations), `${set.name}_annotations.json`)
    else if (format === 'yolo') downloadYoloZip(annotations, `${set.name}_yolo_labels.zip`)
    else if (format === 'coco') downloadAsFile(exportCoco(annotations), `${set.name}_coco.json`)
  }, [set, scopedVideos])

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
          return { ...s, humanAnnotation: ann }
        })}
      }),
    }
    setSet(newSet)
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

  const handleDeleteTrack = useCallback((trackId: number) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    if (!confirm(`Delete track ${trackId}?`)) return
    const newSet: AnnotateSet = {
      ...set,
      videos: (set.videos || []).map(v => {
        if (v.videoId !== selectedVideoId) return v
        return { ...v, segments: (v.segments || []).map(s => {
          if (s.segmentId !== selectedSegmentId) return s
          const ann = getEffectiveAnnotation(s)
          if (!ann) return s
          ann.persons = (ann.persons || []).filter(p => p.trackId !== trackId)
          ann.objects = (ann.objects || []).filter(o => o.trackId !== trackId)
          return { ...s, humanAnnotation: { ...ann } }
        })}
      }),
    }
    setSet(newSet)
    setSelectedTrackId(null)
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

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
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, id, annotateId, updateAnnotateSet])

  const handleTrackEdit = useCallback((updated: PersonAnnotation | ObjectAnnotation) => {
    setLocalEdits(updated)
    setEditDirty(true)
  }, [])

  const handleSaveSegEdits = useCallback(() => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const newSet = { ...set }
    const vid = (newSet.videos || []).find(v => v.videoId === selectedVideoId)
    if (!vid) return
    const seg = (vid.segments || []).find(s => s.segmentId === selectedSegmentId)
    if (!seg) return
    const ann = deepClone(getEffectiveAnnotation(seg))
    if (!ann) return
    if (segScene) ann.scene = segScene
    if (segCamera) ann.camera = segCamera
    ann.events = segEvents
    seg.humanAnnotation = ann
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
    setSegEditDirty(false)
  }, [set, selectedVideoId, selectedSegmentId, segScene, segCamera, segEvents, id, annotateId, updateAnnotateSet])

  const handleSegEdit = useCallback((update: { scene?: SceneAnnotation; camera?: CameraAnnotation; events?: EventAnnotation[] }) => {
    if (update.scene) setSegScene(update.scene)
    if (update.camera) setSegCamera(update.camera)
    if (update.events) setSegEvents(update.events)
    setSegEditDirty(true)
  }, [])

  const handleJsonSave = useCallback((updated: SegmentAnnotation) => {
    if (!set || !selectedVideoId || selectedSegmentId == null) return
    const newSet: AnnotateSet = {
      ...set,
      videos: (set.videos || []).map(v => {
        if (v.videoId !== selectedVideoId) return v
        return { ...v, segments: (v.segments || []).map(s => s.segmentId !== selectedSegmentId ? s : { ...s, humanAnnotation: updated }) }
      }),
    }
    setSet(newSet)
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
  }, [set, selectedVideoId, selectedSegmentId, id, annotateId, updateAnnotateSet])

  const handleSaveEdits = useCallback(() => {
    if (!set || !selectedVideoId || selectedSegmentId == null || !localEdits) return
    const newSet = { ...set }
    const vid = (newSet.videos || []).find(v => v.videoId === selectedVideoId)
    if (!vid) return
    const seg = (vid.segments || []).find(s => s.segmentId === selectedSegmentId)
    if (!seg) return
    const ann = deepClone(getEffectiveAnnotation(seg))
    if (!ann) return
    if ('gender' in localEdits) {
      ann.persons = (ann.persons || []).map(p => p.trackId === localEdits.trackId ? localEdits as PersonAnnotation : p)
    } else {
      ann.objects = (ann.objects || []).map(o => o.trackId === localEdits.trackId ? localEdits as ObjectAnnotation : o)
    }
    seg.humanAnnotation = ann
    updateAnnotateSet(id, annotateId, newSet)
    fetch(`/api/video-annotation/annotate-sets/${annotateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSet) }).catch(() => {})
    setEditDirty(false)
  }, [set, selectedVideoId, selectedSegmentId, localEdits, id, annotateId, updateAnnotateSet])

  // ── Derived data ───────────────────────────────────

  const allSegments = scopedVideos.flatMap(v =>
    (v.segments || []).map(s => ({ ...s, videoId: v.videoId, videoName: v.fileName }))
  )

  useEffect(() => {
    const processing = allSegments.find(s => s.status === 'processing')
    if (!processing) { setPipelinePhase(''); return }
    const phase = (processing as unknown as Record<string, string>).progressPhase
    if (phase) setPipelinePhase(phase)
  }, [allSegments])

  const annotationProgress = useMemo(() => {
    const total = allSegments.length
    if (total === 0) return 0
    const done = allSegments.filter(s => s.status === 'completed').length
    const processing = allSegments.filter(s => s.status === 'processing').length
    return Math.round(((done + processing * 0.5) / total) * 100)
  }, [allSegments])

  useEffect(() => {
    setAnnotatingSegments(prev => {
      const next = new Set(prev)
      for (const key of prev) {
        const [vidId, segIdStr] = key.split('_')
        const seg = allSegments.find(s => s.videoId === vidId && s.segmentId === parseInt(segIdStr))
        if (seg && seg.status !== 'processing') next.delete(key)
      }
      return next.size === prev.size ? prev : next
    })
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

  useEffect(() => {
    if (selectedTrackId == null || !activeAnnotation) { setLocalEdits(null); return }
    const p = activeAnnotation.persons?.find(x => x.trackId === selectedTrackId)
    if (p) { setLocalEdits({ ...p }); setEditDirty(false); return }
    const o = activeAnnotation.objects?.find(x => x.trackId === selectedTrackId)
    if (o) { setLocalEdits({ ...o }); setEditDirty(false); return }
    setLocalEdits(null)
  }, [selectedTrackId, activeAnnotation])

  useEffect(() => {
    if (!activeAnnotation) { setSegScene(null); setSegCamera(null); setSegEvents([]); return }
    setSegScene(activeAnnotation.scene || { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } })
    setSegCamera(activeAnnotation.camera || { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' })
    setSegEvents(activeAnnotation.events || [])
    setSegEditDirty(false)
  }, [activeAnnotation])

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
          <button onClick={() => setShowExport(true)} className="btn-outline rounded-lg px-4 py-2 text-sm">Export</button>
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
                <div className="flex-1 flex items-center justify-center p-4"><VideoPlayer src={`/api/video-annotation/files/${selectedVideo.videoId}`} /></div>
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
              {allSegments.filter(s => s.status === 'completed').length > 0 && <span className="text-xs text-gv-text-muted font-normal">({allSegments.filter(s => s.status === 'completed').length} done)</span>}
              <span className="flex-1" />
              {selectedVideo && (
                <>
                  <input type="range" min="0.15" max="0.8" step="0.05" value={sceneThreshold} onChange={e => setSceneThreshold(parseFloat(e.target.value))} className="w-20 accent-gv-pink h-1.5" />
                  <span className="text-xs text-gv-text-muted font-mono w-8 text-right">{sceneThreshold.toFixed(2)}</span>
                  <button onClick={() => handleDetectScenes(selectedVideo.videoId)} className="px-2 py-0.5 rounded text-xs bg-gv-pink/10 text-gv-pink hover:bg-gv-pink/20" title="Re-detect scenes">Re-detect</button>
                </>
              )}
            </h3>
            <div className="space-y-2">
              {allSegments.map(seg => (
                <div key={`${seg.videoId}_${seg.segmentId}`} className={`card p-3 flex items-center gap-3 transition-all ${selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId ? 'border-gv-pink' : ''}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    seg.status === 'completed' ? 'bg-gv-green-deep' : seg.status === 'processing' ? 'bg-gv-gold animate-pulse' : seg.status === 'failed' ? 'bg-gv-pink' : 'bg-gv-text-muted'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gv-text">Segment {seg.segmentId}</p>
                    <p className="text-xs text-gv-text-dim">{seg.start.toFixed(1)}s – {seg.end.toFixed(1)}s ({seg.videoName})</p>
                  </div>
                  <span className="text-xs text-gv-text-muted capitalize">{seg.status}</span>
                  {seg.status === 'failed' && (
                    <>
                      <span className="text-xs text-gv-gold truncate max-w-[140px]" title={(seg as unknown as Record<string,string>).error}>{(seg as unknown as Record<string,string>).error || 'Pipeline error'}</span>
                      {((seg as unknown as Record<string,unknown>).modelAnnotation as Record<string,unknown>) && (
                        <button onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-gold/10 text-gv-gold-dark hover:bg-gv-gold/20 ml-2">Review Partial</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20">Retry</button>
                    </>
                  )}
                  {seg.status === 'completed' && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId); setViewMode('completed') }} className="rounded px-2 py-0.5 text-xs bg-gv-pink/10 text-gv-pink hover:bg-gv-pink/20 ml-2">Review</button>
                      <button onClick={(e) => { e.stopPropagation(); handleAnnotateSegment(seg.videoId, seg) }} className="rounded px-2 py-0.5 text-xs bg-gv-green/10 text-gv-green-deep hover:bg-gv-green/20" title="Re-annotate">Re-run</button>
                    </>
                  )}
                  {seg.status !== 'completed' && seg.status !== 'processing' && seg.status !== 'failed' && workerStatus === 'ok' && (
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
            <div className="mt-4 space-y-1 text-xs text-gv-text-dim">{allSegments.filter(s => s.status === 'completed').length} / {allSegments.length} segments done</div>
            <div className="flex flex-wrap gap-1 mt-2">{allSegments.map(s => (<span key={`${s.videoId}_${s.segmentId}`} className={`w-3 h-3 rounded ${s.status === 'completed' ? 'bg-gv-green-deep' : s.status === 'processing' ? 'bg-gv-gold animate-pulse' : s.status === 'failed' ? 'bg-gv-pink' : 'bg-gv-border'}`} />))}</div>
          </div>
        </div>
      )}

      {phase === 'completed' && (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[45%] min-w-[400px] flex flex-col border-r border-gv-border/50">
            {selectedVideo && <div className="flex-shrink-0"><VideoPlayer src={`/api/video-annotation/files/${selectedVideo.videoId}`} /></div>}
            <div className="flex-shrink-0 bg-gv-surface border-t border-gv-border/50 px-3 py-1.5 flex items-center gap-2">
              {allSegments.length > 0 && (
                <button onClick={() => setViewMode(null)} className="px-2 py-0.5 rounded text-xs bg-gv-bg text-gv-text-dim hover:bg-gv-pink/10">← Segments</button>
              )}
              <span className="flex-1" />
              {selectedSegment && selectedVideoId && (
                <button onClick={() => { const seg = { ...selectedSegment, videoId: selectedVideoId }; handleAnnotateSegment(selectedVideoId, seg as SegmentState) }} className="px-2 py-0.5 rounded text-xs bg-gv-green/20 text-gv-green-deep hover:bg-gv-green/30 mr-1" title="Re-annotate current segment">🔄 Re-run Segment</button>
              )}
              <button onClick={handleAnnotateAll} className="px-3 py-1 rounded text-xs font-medium bg-gv-green/20 text-gv-green-deep hover:bg-gv-green/30" title="Re-annotate all segments">🔄 Re-run All</button>
            </div>
            <div className="p-1.5 flex gap-1 overflow-x-auto bg-gv-surface flex-shrink-0 border-t border-gv-border/30">
              {allSegments.map(seg => (
                <button key={`${seg.videoId}_${seg.segmentId}`} onClick={() => { setSelectedVideoId(seg.videoId); setSelectedSegmentId(seg.segmentId) }}
                  className={`flex-shrink-0 px-2 py-0.5 rounded text-xs transition-colors ${selectedSegmentId === seg.segmentId && selectedVideoId === seg.videoId ? 'bg-gv-pink/20 text-gv-pink font-medium' : 'bg-gv-bg text-gv-text-dim hover:bg-gv-bg-deep'}`}>S{seg.segmentId}</button>
              ))}
            </div>
            {selectedVideo && selectedSegment && (
              <div className="flex-1 overflow-auto p-2 min-h-0">
                <AnnotationCanvas imageUrl={`/api/video-annotation/files/${selectedVideo.videoId}?t=${(selectedSegment.start || 0) + 1}`} persons={activeAnnotation?.persons || []} objects={activeAnnotation?.objects || []} imgWidth={selectedVideo.width || 1920} imgHeight={selectedVideo.height || 1080} mode={canvasMode} hiddenTrackIds={hiddenTrackIds} onModeChange={setCanvasMode} onDrawBox={handleDrawBox} onSelectTrack={setSelectedTrackId} onResizeBox={handleResizeBox} onDeleteTrack={handleDeleteTrack} selectedTrackId={selectedTrackId} />
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
                {selectedTrackId !== null && localEdits && (
                  <div className="mb-4 p-3 rounded-lg border border-gv-border bg-gv-surface">
                    <h4 className="text-sm font-semibold text-gv-text mb-2 flex items-center justify-between">
                      <span>Track {selectedTrackId}{('_className' in localEdits) && <span className="ml-2 text-xs text-gv-text-muted font-normal">({(localEdits as Record<string,unknown>)._className as string})</span>}</span>
                      <button onClick={() => handleDeleteTrack(selectedTrackId!)} className="text-xs text-gv-pink-dark hover:text-gv-pink px-2 py-0.5 rounded hover:bg-gv-pink/10 transition-colors" title="Delete track (Delete key)">Delete</button>
                    </h4>
                    <TrackEditor person={'gender' in localEdits ? localEdits as PersonAnnotation : null} object={!('gender' in localEdits) ? localEdits as ObjectAnnotation : null} onChange={handleTrackEdit} onSave={handleSaveEdits} dirty={editDirty} detectionConfidence={(localEdits as unknown as Record<string,unknown>)._detectionConfidence as number | undefined} />
                  </div>
                )}
                {segScene && segCamera && (
                  <div className="mb-4 p-3 rounded-lg border border-gv-border bg-gv-surface">
                    <h4 className="text-sm font-semibold text-gv-text mb-2">Scene &amp; Camera</h4>
                    <SceneCameraEditor scene={segScene} camera={segCamera} events={segEvents} onChange={handleSegEdit} onSave={handleSaveSegEdits} dirty={segEditDirty} />
                  </div>
                )}
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

      <ExportDialog open={showExport} onClose={() => setShowExport(false)} onExport={handleExport} />
      </main>
    </div>
  )
}
