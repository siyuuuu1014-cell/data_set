import { randomUUID } from 'crypto'
import type { AnnotateSet, SegmentAnnotation, SegmentState, VideoTaskItem } from './types'
import { withDerivedAnnotationStatuses } from './status'
import { MIN_MANUAL_SEGMENT_DURATION } from './segment-split'

export type TimelinePreserve = 'left' | 'right' | 'none'
export class SegmentTimelineError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) { super(message); this.name = 'SegmentTimelineError' }
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }

function snapshot(video: VideoTaskItem, operation: string) {
  video.timelineHistory ||= []
  video.timelineHistory.push({ id: randomUUID(), createdAt: new Date().toISOString(), operation, segments: clone(video.segments) })
  video.timelineHistory = video.timelineHistory.slice(-10)
}

function videoFor(task: AnnotateSet, videoId: string): VideoTaskItem {
  const video = task.videos.find(item => item.videoId === videoId)
  if (!video) throw new SegmentTimelineError('VIDEO_NOT_FOUND', 404, 'Video not found')
  if (video.segments.some(segment => segment.status === 'processing')) throw new SegmentTimelineError('VIDEO_BUSY', 409, 'Wait for active annotation jobs before editing the timeline')
  return video
}

function trimAnnotation(annotation: SegmentAnnotation | null, segmentId: number, start: number, end: number): SegmentAnnotation | null {
  if (!annotation) return null
  const next = clone(annotation)
  next.segmentId = segmentId; next.start = start; next.end = end
  if (next.frames?.length) {
    next.frames = next.frames.filter(frame => frame.timestamp >= start && frame.timestamp < end)
    const personTracks = new Set(next.frames.flatMap(frame => frame.observations.filter(item => item.entityType === 'person').map(item => item.trackId)))
    const objectTracks = new Set(next.frames.flatMap(frame => frame.observations.filter(item => item.entityType === 'object').map(item => item.trackId)))
    next.persons = next.persons.filter(person => personTracks.has(person.trackId))
    next.objects = next.objects.filter(object => objectTracks.has(object.trackId))
  }
  next._humanEdited = true
  return next
}

function preserved(source: SegmentState, segmentId: number, start: number, end: number): SegmentState {
  return {
    ...clone(source), segmentId, start, end,
    modelAnnotation: trimAnnotation(source.modelAnnotation, segmentId, start, end),
    humanAnnotation: trimAnnotation(source.humanAnnotation, segmentId, start, end),
    reviewStatus: 'needs_review',
  }
}

function draft(segmentId: number, start: number, end: number): SegmentState {
  return { segmentId, start, end, status: 'draft', modelAnnotation: null, humanAnnotation: null, reviewStatus: 'needs_review' }
}

function finish(task: AnnotateSet): AnnotateSet {
  task.updatedAt = new Date().toISOString()
  return withDerivedAnnotationStatuses(task)
}

export function splitAnnotatedSegment(task: AnnotateSet, videoId: string, segmentId: number, time: number, preserve: TimelinePreserve): AnnotateSet {
  const video = videoFor(task, videoId)
  const index = video.segments.findIndex(item => item.segmentId === segmentId)
  if (index < 0) throw new SegmentTimelineError('SEGMENT_NOT_FOUND', 404, 'Segment not found')
  const source = video.segments[index]
  if (!Number.isFinite(time)) throw new SegmentTimelineError('INVALID_BOUNDARY', 400, 'Split time must be a finite number')
  const fps = video.fps > 0 ? video.fps : 30
  const splitTime = Number((Math.round(time * fps) / fps).toFixed(6))
  if (splitTime - source.start < MIN_MANUAL_SEGMENT_DURATION || source.end - splitTime < MIN_MANUAL_SEGMENT_DURATION) throw new SegmentTimelineError('INVALID_BOUNDARY', 400, 'Both split segments must be at least 0.5 seconds')
  snapshot(video, `split S${segmentId} at ${splitTime}`)
  const newId = Math.max(0, ...video.segments.map(item => item.segmentId)) + 1
  const left = preserve === 'left' ? preserved(source, source.segmentId, source.start, splitTime) : draft(source.segmentId, source.start, splitTime)
  const right = preserve === 'right' ? preserved(source, newId, splitTime, source.end) : draft(newId, splitTime, source.end)
  video.segments.splice(index, 1, left, right)
  video.segments.sort((a, b) => a.start - b.start || a.end - b.end)
  return finish(task)
}

export function mergeAdjacentSegments(task: AnnotateSet, videoId: string, leftSegmentId: number, preserve: TimelinePreserve): AnnotateSet {
  const video = videoFor(task, videoId)
  const ordered = [...video.segments].sort((a, b) => a.start - b.start || a.end - b.end)
  const index = ordered.findIndex(item => item.segmentId === leftSegmentId)
  if (index < 0 || index >= ordered.length - 1) throw new SegmentTimelineError('ADJACENT_NOT_FOUND', 404, 'No following segment to merge')
  const left = ordered[index]; const right = ordered[index + 1]
  snapshot(video, `merge S${left.segmentId} + S${right.segmentId}`)
  const source = preserve === 'right' ? right : left
  const merged = preserve === 'none' ? draft(left.segmentId, left.start, right.end) : preserved(source, left.segmentId, left.start, right.end)
  video.segments = video.segments.filter(item => item.segmentId !== left.segmentId && item.segmentId !== right.segmentId)
  video.segments.push(merged)
  video.segments.sort((a, b) => a.start - b.start || a.end - b.end)
  return finish(task)
}

export function adjustSegmentBoundary(task: AnnotateSet, videoId: string, leftSegmentId: number, time: number): AnnotateSet {
  const video = videoFor(task, videoId)
  const ordered = [...video.segments].sort((a, b) => a.start - b.start || a.end - b.end)
  const index = ordered.findIndex(item => item.segmentId === leftSegmentId)
  if (index < 0 || index >= ordered.length - 1) throw new SegmentTimelineError('ADJACENT_NOT_FOUND', 404, 'No following segment boundary found')
  const left = ordered[index]; const right = ordered[index + 1]
  if (!Number.isFinite(time)) throw new SegmentTimelineError('INVALID_BOUNDARY', 400, 'Boundary time must be a finite number')
  const fps = video.fps > 0 ? video.fps : 30
  const boundary = Number((Math.round(time * fps) / fps).toFixed(6))
  if (boundary - left.start < MIN_MANUAL_SEGMENT_DURATION || right.end - boundary < MIN_MANUAL_SEGMENT_DURATION) throw new SegmentTimelineError('INVALID_BOUNDARY', 400, 'Both adjacent segments must remain at least 0.5 seconds')
  snapshot(video, `move boundary S${left.segmentId}/S${right.segmentId} to ${boundary}`)
  video.segments = video.segments.map(item => item.segmentId === left.segmentId
    ? preserved(left, left.segmentId, left.start, boundary)
    : item.segmentId === right.segmentId ? preserved(right, right.segmentId, boundary, right.end) : item)
  return finish(task)
}

export function undoTimelineEdit(task: AnnotateSet, videoId: string): AnnotateSet {
  const video = videoFor(task, videoId)
  const history = video.timelineHistory || []
  const last = history.pop()
  if (!last) throw new SegmentTimelineError('NOTHING_TO_UNDO', 409, 'No timeline edit to undo')
  video.segments = clone(last.segments)
  video.timelineHistory = history
  return finish(task)
}
