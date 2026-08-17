import assert from 'node:assert/strict'
import test from 'node:test'
import { SegmentSplitError, splitDraftVideoSegment } from '../../services/video-annotation/segment-split'
import type { AnnotateSet, SegmentState } from '../../services/video-annotation/types'

function draft(segmentId: number, start: number, end: number): SegmentState {
  return {
    segmentId,
    start,
    end,
    status: 'draft',
    modelAnnotation: null,
    humanAnnotation: null,
  }
}

function annotationSet(segments: SegmentState[]): AnnotateSet {
  return {
    id: 'set-1',
    projectId: 'project-1',
    name: 'Manual split test',
    status: 'awaiting_segment_review',
    videos: [{
      videoId: 'video-1',
      fileName: 'video.mp4',
      filePath: 'uploads/video-1',
      duration: 12,
      fps: 25,
      width: 1920,
      height: 1080,
      status: 'pending',
      uploadProgress: 100,
      segments,
    }],
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  }
}

test('manual split snaps to FPS and preserves contiguous chronological coverage', () => {
  const source = annotationSet([draft(1, 0, 2), draft(2, 2, 10), draft(3, 10, 12)])
  const result = splitDraftVideoSegment(source, 'video-1', 2, 4.251)
  const segments = result.task.videos[0].segments

  assert.equal(result.splitTime, 4.24)
  assert.deepEqual(segments.map(segment => segment.segmentId), [1, 2, 3, 4])
  assert.deepEqual(segments.map(segment => [segment.start, segment.end]), [
    [0, 2], [2, 4.24], [4.24, 10], [10, 12],
  ])
  assert.equal(result.leftSegmentId, 2)
  assert.equal(result.rightSegmentId, 3)
  assert.equal(segments.every(segment => segment.status === 'draft'), true)
  assert.equal(source.videos[0].segments.length, 3)
})

test('manual split rejects a cut that would create a sub-minimum segment', () => {
  const source = annotationSet([draft(1, 0, 5)])
  assert.throws(
    () => splitDraftVideoSegment(source, 'video-1', 1, 0.2),
    (error: unknown) => error instanceof SegmentSplitError && error.code === 'INVALID_SPLIT_TIME',
  )
})

test('manual split never clears existing model or human annotations', () => {
  const source = annotationSet([{
    ...draft(1, 0, 5),
    status: 'completed',
    modelAnnotation: {
      segmentId: 1,
      start: 0,
      end: 5,
      scene: { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } },
      camera: { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' },
      persons: [],
      objects: [],
      events: [],
    },
  }])

  assert.throws(
    () => splitDraftVideoSegment(source, 'video-1', 1, 2.5),
    (error: unknown) => error instanceof SegmentSplitError && error.code === 'ANNOTATIONS_EXIST',
  )
  assert.equal(source.videos[0].segments[0].modelAnnotation?.end, 5)
})

test('manual split rejects videos with an active annotation job', () => {
  const source = annotationSet([{ ...draft(1, 0, 5), status: 'processing', workerJobId: 'job-1' }])
  assert.throws(
    () => splitDraftVideoSegment(source, 'video-1', 1, 2.5),
    (error: unknown) => error instanceof SegmentSplitError && error.code === 'VIDEO_BUSY',
  )
})
