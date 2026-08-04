import type {
  AnnotateSet,
  AnnotateSetStatus,
  ReviewStatus,
  SegmentState,
  VideoTaskItem,
  VideoTaskStatus,
} from '@/services/video-annotation/types'

export interface VideoReviewSummary {
  total: number
  approved: number
  status: ReviewStatus | 'not_ready'
}

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

  // A video is mid-upload only while progress is actively between 0 and 100.
  // progress 0 means "not yet uploaded" (falls through to pending) and progress
  // 100 means finished — otherwise a stale 0 from persistence would permanently
  // mark an uploaded video as uploading.
  if (Number.isFinite(video.uploadProgress) && video.uploadProgress > 0 && video.uploadProgress < 100) return 'uploading'
  if (segments.some(segment => segment.status === 'processing')) return 'processing'
  if (segments.length > 0 && segments.every(segment => TERMINAL_SEGMENT_STATUSES.has(segment.status))) {
    if (segments.every(segment => segment.status === 'failed')) return 'failed'
    if (segments.some(segment => segment.status === 'failed' || segment.status === 'partial_completed')) return 'partial_completed'
    if (segments.every(segment => SUCCESSFUL_SEGMENT_STATUSES.has(segment.status))) return 'completed'
  }
  return 'pending'
}

export function deriveVideoReviewSummary(video: VideoTaskItem): VideoReviewSummary {
  const reviewableSegments = (video.segments || []).filter(segment => (
    // `_hasAnnotation` is a lightweight marker used by the summary list API
    // (annotations stripped); falls back to checking the real payloads.
    segment._hasAnnotation === true
    || Boolean(segment.humanAnnotation || segment.modelAnnotation)
  ))
  const approved = reviewableSegments.filter(segment => segment.reviewStatus === 'approved').length

  if (reviewableSegments.length === 0) return { total: 0, approved: 0, status: 'not_ready' }
  if (reviewableSegments.some(segment => segment.reviewStatus === 'rejected')) {
    return { total: reviewableSegments.length, approved, status: 'rejected' }
  }
  if (reviewableSegments.some(segment => segment.reviewStatus === 'needs_review')) {
    return { total: reviewableSegments.length, approved, status: 'needs_review' }
  }
  if (reviewableSegments.some(segment => segment.reviewStatus === 'modified')) {
    return { total: reviewableSegments.length, approved, status: 'modified' }
  }
  if (approved === reviewableSegments.length) {
    return { total: reviewableSegments.length, approved, status: 'approved' }
  }
  return { total: reviewableSegments.length, approved, status: 'unreviewed' }
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
  if (videoStatuses.every(status => status === 'completed')) {
    const reviewSummaries = videos.map(deriveVideoReviewSummary).filter(summary => summary.total > 0)
    if (reviewSummaries.length === 0) return 'completed'
    return reviewSummaries.every(summary => summary.status === 'approved') ? 'approved' : 'awaiting_review'
  }

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

export type VideoRemovalErrorCode = 'VIDEO_NOT_FOUND' | 'VIDEO_BUSY'

export class VideoRemovalError extends Error {
  constructor(
    public readonly code: VideoRemovalErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'VideoRemovalError'
  }
}

/** Remove one non-processing video while preserving every other project item. */
export function removeVideoFromAnnotationSet(
  task: AnnotateSet,
  videoId: string,
): AnnotateSet {
  const videos = task.videos || []
  const selected = videos.find(video => video.videoId === videoId)
  if (!selected) {
    throw new VideoRemovalError('VIDEO_NOT_FOUND', 404, 'Video not found in this project')
  }
  if ((selected.segments || []).some(segment => segment.status === 'processing')) {
    throw new VideoRemovalError(
      'VIDEO_BUSY',
      409,
      'Video is still being annotated; wait for the active job to finish before deleting it',
    )
  }

  return withDerivedAnnotationStatuses({
    ...task,
    videos: videos.filter(video => video.videoId !== videoId),
    updatedAt: new Date().toISOString(),
  })
}
