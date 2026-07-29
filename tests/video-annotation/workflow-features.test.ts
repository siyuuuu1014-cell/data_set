import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveQualityIssues } from '../../services/video-annotation/quality-center'
import { applyManualIdentityReview, mergeVideoPeople, splitVideoPerson } from '../../services/video-annotation/identity-review'
import { adjustSegmentBoundary, mergeAdjacentSegments, splitAnnotatedSegment, undoTimelineEdit } from '../../services/video-annotation/segment-timeline'
import type { AnnotateSet, SegmentAnnotation } from '../../services/video-annotation/types'

function annotation(segmentId: number, start: number, end: number, trackId = 1, personId = 'v1:person:1'): SegmentAnnotation {
  return {
    segmentId, start, end,
    scene: { tags: ['room'], place: { type: 'room', indoor: true, weather: null, lighting: 'bright', timeOfDay: 'unknown' } },
    camera: { shot: 'medium', angle: 'eye_level', movement: [], lens: 'unknown', stabilization: 'unknown' },
    persons: [{ trackId, personId, gender: 'unknown', ageGroup: 'unknown', hair: { color: 'unknown', style: 'unknown' }, expression: 'unknown', pose: 'unknown', action: [], facing: 'unknown', occlusion: 0, clothing: [], bbox: { x: 1, y: 1, width: 10, height: 10 }, depth: null, keypoints: [] }],
    objects: [], events: [{ type: 'visual_activity', description: 'A person stands.', confidence: 0.7 }],
    frames: [{ frameIndex: Math.round(start * 10), timestamp: start + 0.2, imageWidth: 100, imageHeight: 100, observations: [{ trackId, entityType: 'person', className: 'person', bbox: { x: 1, y: 1, width: 10, height: 10 }, source: 'model' }] }],
  }
}

function fixture(): AnnotateSet {
  return { id: 'a1', projectId: 'p1', name: 'test', status: 'completed', createdAt: 'now', updatedAt: 'now', videos: [{ videoId: 'v1', fileName: 'one.mp4', filePath: 'uploads/v1', duration: 10, fps: 10, width: 100, height: 100, status: 'completed', uploadProgress: 100, segments: [
    { segmentId: 1, start: 0, end: 5, status: 'completed', modelAnnotation: annotation(1, 0, 5), humanAnnotation: null },
    { segmentId: 2, start: 5, end: 10, status: 'completed', modelAnnotation: annotation(2, 5, 10, 2, 'v1:person:2'), humanAnnotation: null },
  ] }] }
}

test('quality center derives actionable issues without mutating annotations', () => {
  const task = fixture(); const before = JSON.stringify(task)
  const issues = deriveQualityIssues(task)
  assert.ok(issues.some(issue => issue.kind === 'unknown_fields'))
  assert.ok(issues.some(issue => issue.kind === 'unreviewed'))
  assert.equal(JSON.stringify(task), before)
})

test('manual identity merge is persisted and reapplied after a model rerun', () => {
  const task = mergeVideoPeople(fixture(), 'v1', 'v1:person:2', 'v1:person:1')
  assert.equal(task.videos[0].segments[1].modelAnnotation?.persons[0].personId, 'v1:person:1')
  task.videos[0].segments[1].modelAnnotation!.persons[0].personId = 'v1:person:2'
  assert.equal(applyManualIdentityReview(task.videos[0]), true)
  assert.equal(task.videos[0].segments[1].modelAnnotation?.persons[0].personId, 'v1:person:1')
})

test('manual identity split affects only the selected segment track and locks it', () => {
  const result = splitVideoPerson(fixture(), 'v1', 1, 1)
  assert.match(result.personId, /^v1:manual-person:/)
  assert.equal(result.task.videos[0].segments[0].modelAnnotation?.persons[0].personId, result.personId)
  assert.equal(result.task.videos[0].segments[1].modelAnnotation?.persons[0].personId, 'v1:person:2')
  assert.ok(result.task.videos[0].identityReview?.lockedPersonIds.includes(result.personId))
})

test('annotated split keeps stable left id, allocates a new right id, and supports exact undo', () => {
  const task = fixture(); const original = JSON.stringify(task.videos[0].segments)
  splitAnnotatedSegment(task, 'v1', 1, 2.5, 'left')
  assert.equal(task.videos[0].segments.length, 3)
  assert.equal(task.videos[0].segments[0].segmentId, 1)
  assert.equal(task.videos[0].segments[1].status, 'draft')
  assert.equal(task.videos[0].timelineHistory?.length, 1)
  undoTimelineEdit(task, 'v1')
  assert.equal(JSON.stringify(task.videos[0].segments), original)
})

test('boundary adjustment trims both annotations and marks them for review', () => {
  const task = fixture(); adjustSegmentBoundary(task, 'v1', 1, 4)
  assert.equal(task.videos[0].segments[0].end, 4)
  assert.equal(task.videos[0].segments[1].start, 4)
  assert.equal(task.videos[0].segments[0].reviewStatus, 'needs_review')
  assert.equal(task.videos[0].segments[1].modelAnnotation?.start, 4)
})

test('merge with reset creates one draft range and remains undoable', () => {
  const task = fixture(); mergeAdjacentSegments(task, 'v1', 1, 'none')
  assert.equal(task.videos[0].segments.length, 1)
  assert.equal(task.videos[0].segments[0].status, 'draft')
  assert.equal(task.videos[0].segments[0].start, 0)
  assert.equal(task.videos[0].segments[0].end, 10)
  undoTimelineEdit(task, 'v1')
  assert.equal(task.videos[0].segments.length, 2)
})
