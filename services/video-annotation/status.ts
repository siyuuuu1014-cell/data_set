import type {
  AnnotateSet,
  AnnotateSetStatus,
  SegmentState,
  VideoTaskItem,
  VideoTaskStatus,
} from '@/services/video-annotation/types'

const SUCCESSFUL_SEGMENT_STATUSES = new Set<SegmentState['status']>(['completed', 'skipped'])
const TERMINAL_SEGMENT_STATUSES = new Set<SegmentState['status']>([
  'completed',
  'partial_completed',
  'failed',
  'skipped',
])
const LEGACY_CORE_PIPELINE_ERROR_PREFIXES = [
  'Frame extraction failed:',
  'Keyframe extraction failed:',
  'YOLO11 detection failed:',
  'LocateAnything grounding failed:',
  'Qwen3-VL semantic failed:',
]

export function hasDegradedPipelineResult(segment: SegmentState): boolean {
  const annotation = segment.modelAnnotation
  if (!annotation) return false
  if (annotation._pipeline_status === 'partial_completed') return true
  return (annotation._pipeline_errors || []).some(error => (
    LEGACY_CORE_PIPELINE_ERROR_PREFIXES.some(prefix => error.startsWith(prefix))
  ))
}

function normalizeSegmentStatus(segment: SegmentState): SegmentState {
  if (
    (segment.status === 'completed' || segment.status === 'partial_completed')
    && hasDegradedPipelineResult(segment)
  ) {
    return { ...segment, status: 'partial_completed' }
  }
  return segment
}

export function deriveVideoTaskStatus(video: VideoTaskItem): VideoTaskStatus {
  const segments = video.segments || []

  if (Number.isFinite(video.uploadProgress) && video.uploadProgress >= 0 && video.uploadProgress < 100) return 'uploading'
  if (segments.some(segment => segment.status === 'processing')) return 'processing'
  if (segments.length > 0 && segments.every(segment => TERMINAL_SEGMENT_STATUSES.has(segment.status))) {
    if (segments.every(segment => segment.status === 'failed')) return 'failed'
    if (segments.some(segment => segment.status === 'failed' || segment.status === 'partial_completed')) return 'partial_completed'
    if (segments.every(segment => SUCCESSFUL_SEGMENT_STATUSES.has(segment.status))) return 'completed'
  }
  return 'pending'
}

export function deriveAnnotateSetStatus(set: AnnotateSet): AnnotateSetStatus {
  if (set.status === 'cancelled') return 'cancelled'

  const videos = set.videos || []
  if (videos.length === 0) return 'draft'

  const videoStatuses = videos.map(deriveVideoTaskStatus)
  if (videoStatuses.some(status => status === 'uploading')) return 'uploading'
  if (videoStatuses.some(status => status === 'processing')) return 'annotating'
  if (videoStatuses.every(status => status === 'failed')) return 'failed'
  if (videoStatuses.some(status => status === 'failed' || status === 'partial_completed')) return 'partial_completed'
  if (videoStatuses.every(status => status === 'completed')) return 'completed'

  const hasSegments = videos.some(video => (video.segments || []).length > 0)
  return hasSegments ? 'awaiting_segment_review' : 'draft'
}

export function withDerivedAnnotationStatuses(set: AnnotateSet): AnnotateSet {
  const videos = (set.videos || []).map(video => {
    const normalizedVideo = {
      ...video,
      segments: (video.segments || []).map(normalizeSegmentStatus),
    }
    return {
      ...normalizedVideo,
      status: deriveVideoTaskStatus(normalizedVideo),
    }
  })
  const normalized = { ...set, videos }
  return { ...normalized, status: deriveAnnotateSetStatus(normalized) }
}
