import type {
  AnnotateSet,
  AnnotateSetStatus,
  SegmentState,
  VideoTaskItem,
  VideoTaskStatus,
} from '@/services/video-annotation/types'

const SUCCESSFUL_SEGMENT_STATUSES = new Set<SegmentState['status']>(['completed', 'skipped'])

export function deriveVideoTaskStatus(video: VideoTaskItem): VideoTaskStatus {
  const segments = video.segments || []

  if (Number.isFinite(video.uploadProgress) && video.uploadProgress >= 0 && video.uploadProgress < 100) return 'uploading'
  if (segments.some(segment => segment.status === 'processing')) return 'processing'
  if (segments.some(segment => segment.status === 'failed')) return 'failed'
  if (segments.length > 0 && segments.every(segment => SUCCESSFUL_SEGMENT_STATUSES.has(segment.status))) return 'completed'
  return 'pending'
}

export function deriveAnnotateSetStatus(set: AnnotateSet): AnnotateSetStatus {
  if (set.status === 'cancelled') return 'cancelled'

  const videos = set.videos || []
  if (videos.length === 0) return 'draft'

  const videoStatuses = videos.map(deriveVideoTaskStatus)
  if (videoStatuses.some(status => status === 'uploading')) return 'uploading'
  if (videoStatuses.some(status => status === 'processing')) return 'annotating'
  if (videoStatuses.some(status => status === 'failed')) return 'failed'
  if (videoStatuses.every(status => status === 'completed')) return 'completed'

  const hasSegments = videos.some(video => (video.segments || []).length > 0)
  return hasSegments ? 'awaiting_segment_review' : 'draft'
}

export function withDerivedAnnotationStatuses(set: AnnotateSet): AnnotateSet {
  const videos = (set.videos || []).map(video => ({
    ...video,
    status: deriveVideoTaskStatus(video),
  }))
  const normalized = { ...set, videos }
  return { ...normalized, status: deriveAnnotateSetStatus(normalized) }
}
