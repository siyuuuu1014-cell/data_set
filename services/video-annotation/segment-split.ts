import type { AnnotateSet, SegmentState } from './types'
import { withDerivedAnnotationStatuses } from './status'

export const MIN_MANUAL_SEGMENT_DURATION = 0.5

export type SegmentSplitErrorCode =
  | 'VIDEO_NOT_FOUND'
  | 'SEGMENT_NOT_FOUND'
  | 'VIDEO_BUSY'
  | 'ANNOTATIONS_EXIST'
  | 'INVALID_SPLIT_TIME'

export class SegmentSplitError extends Error {
  constructor(
    public readonly code: SegmentSplitErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SegmentSplitError'
  }
}

export interface SegmentSplitResult {
  task: AnnotateSet
  splitTime: number
  leftSegmentId: number
  rightSegmentId: number
}

export function isUntouchedDraftSegment(segment: SegmentState): boolean {
  return (
    segment.status === 'draft'
    && segment.modelAnnotation === null
    && segment.humanAnnotation === null
    && !segment.workerJobId
  )
}

/**
 * Split one automatically detected segment before annotation starts.
 * All segments are re-numbered chronologically only because this first-phase
 * operation is limited to a completely untouched draft video.
 */
export function splitDraftVideoSegment(
  task: AnnotateSet,
  videoId: string,
  segmentId: number,
  requestedTime: number,
): SegmentSplitResult {
  const video = (task.videos || []).find(item => item.videoId === videoId)
  if (!video) {
    throw new SegmentSplitError('VIDEO_NOT_FOUND', 404, 'Video not found in this project')
  }
  if ((video.segments || []).some(segment => segment.status === 'processing')) {
    throw new SegmentSplitError(
      'VIDEO_BUSY',
      409,
      'Wait for the active annotation job to finish before changing segment boundaries',
    )
  }
  if (!(video.segments || []).every(isUntouchedDraftSegment)) {
    throw new SegmentSplitError(
      'ANNOTATIONS_EXIST',
      409,
      'Manual Split currently supports only videos whose segments have not been annotated',
    )
  }

  const selected = video.segments.find(segment => segment.segmentId === segmentId)
  if (!selected) {
    throw new SegmentSplitError('SEGMENT_NOT_FOUND', 404, 'Segment not found in this video')
  }
  if (!Number.isFinite(requestedTime)) {
    throw new SegmentSplitError('INVALID_SPLIT_TIME', 400, 'Split time must be a finite number')
  }

  const fps = Number.isFinite(video.fps) && video.fps > 0 ? video.fps : 30
  const snappedTime = Number((Math.round(requestedTime * fps) / fps).toFixed(6))
  if (
    snappedTime - selected.start < MIN_MANUAL_SEGMENT_DURATION
    || selected.end - snappedTime < MIN_MANUAL_SEGMENT_DURATION
  ) {
    throw new SegmentSplitError(
      'INVALID_SPLIT_TIME',
      400,
      `Each side of a manual split must be at least ${MIN_MANUAL_SEGMENT_DURATION.toFixed(1)} seconds`,
    )
  }

  const replacement = (start: number, end: number): SegmentState => ({
    segmentId: 0,
    start,
    end,
    status: 'draft',
    modelAnnotation: null,
    humanAnnotation: null,
  })
  const chronological = video.segments
    .flatMap(segment => segment.segmentId === segmentId
      ? [replacement(segment.start, snappedTime), replacement(snappedTime, segment.end)]
      : [{ ...segment }])
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .map((segment, index) => ({ ...segment, segmentId: index + 1 }))

  const splitIndex = chronological.findIndex(segment => (
    segment.start === selected.start && segment.end === snappedTime
  ))
  const updatedTask = withDerivedAnnotationStatuses({
    ...task,
    videos: task.videos.map(item => item.videoId === videoId
      ? { ...item, segments: chronological }
      : item),
    updatedAt: new Date().toISOString(),
  })

  return {
    task: updatedTask,
    splitTime: snappedTime,
    leftSegmentId: chronological[splitIndex].segmentId,
    rightSegmentId: chronological[splitIndex + 1].segmentId,
  }
}
