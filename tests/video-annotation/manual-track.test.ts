import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addManualTrack,
  assignMissingManualPersonIds,
  findAnnotationTrackConflicts,
} from '../../services/video-annotation/manual-track'
import type {
  AnnotateSet,
  PersonAnnotation,
  SegmentAnnotation,
  SegmentState,
} from '../../services/video-annotation/types'

function annotation(segmentId: number): SegmentAnnotation {
  return {
    segmentId,
    start: segmentId - 1,
    end: segmentId,
    scene: { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } },
    camera: { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' },
    persons: [],
    objects: [],
    events: [],
    frames: [{
      frameIndex: segmentId * 10,
      timestamp: segmentId - 0.5,
      imageWidth: 640,
      imageHeight: 360,
      observations: [],
    }],
  }
}

function segment(segmentId: number): SegmentState {
  return {
    segmentId,
    start: segmentId - 1,
    end: segmentId,
    status: 'completed',
    modelAnnotation: annotation(segmentId),
    humanAnnotation: null,
  }
}

function task(segments: SegmentState[] = [segment(1)]): AnnotateSet {
  return {
    id: 'set-1',
    projectId: 'project-1',
    name: 'manual tracks',
    status: 'awaiting_review',
    videos: [{
      videoId: 'video-1',
      fileName: 'sample.mp4',
      filePath: 'uploads/video-1',
      duration: 2,
      fps: 10,
      width: 640,
      height: 360,
      status: 'completed',
      segments,
      uploadProgress: 100,
    }],
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  }
}

function drawPerson(source: AnnotateSet, segmentId = 1) {
  return addManualTrack(source, {
    videoId: 'video-1',
    segmentId,
    frameIndex: segmentId * 10,
    timestamp: segmentId - 0.5,
    imageWidth: 640,
    imageHeight: 360,
    entityType: 'person',
    className: 'person',
    bbox: { x: 10, y: 20, width: 100, height: 150 },
  })
}

test('manual Draw allocates unique monotonic Track IDs and video person identities', () => {
  const first = drawPerson(task())
  const second = drawPerson(first.task)
  const human = second.task.videos[0].segments[0].humanAnnotation!

  assert.equal(human.persons.length, 2)
  assert.notEqual(first.trackId, second.trackId)
  assert.equal(second.trackId, first.trackId + 1)
  assert.equal(first.personId, 'video-1:manual-person:1')
  assert.equal(second.personId, 'video-1:manual-person:2')
  assert.equal(second.task.videos[0].nextManualPersonId, 3)
  assert.equal(second.task.videos[0].segments[0].nextManualTrackId, second.trackId + 1)
  assert.deepEqual(findAnnotationTrackConflicts(human), [])
})

test('manual Track IDs may repeat across segments while person IDs remain video-unique', () => {
  const first = drawPerson(task([segment(1), segment(2)]), 1)
  const second = drawPerson(first.task, 2)

  assert.equal(first.trackId, second.trackId)
  assert.notEqual(first.personId, second.personId)
})

test('deleted manual Track IDs are not reused', () => {
  const first = drawPerson(task())
  const current = first.task.videos[0].segments[0]
  current.humanAnnotation!.persons = []
  current.humanAnnotation!.frames![0].observations = []

  const second = drawPerson(first.task)
  assert.equal(second.trackId, first.trackId + 1)
})

test('legacy manual persons receive distinct identities without inferred merging', () => {
  const legacy = task([segment(1), segment(2)])
  for (const item of legacy.videos[0].segments) {
    const person: PersonAnnotation = {
      trackId: 8,
      personId: null,
      gender: 'unknown',
      ageGroup: 'unknown',
      hair: { color: 'unknown', style: 'unknown' },
      expression: 'unknown',
      pose: 'unknown',
      action: [],
      facing: 'unknown',
      occlusion: 0,
      clothing: [],
      bbox: { x: 1, y: 1, width: 20, height: 30 },
      depth: null,
      keypoints: [],
      _className: 'manual',
    }
    item.humanAnnotation = { ...annotation(item.segmentId), persons: [person], _humanEdited: true }
  }

  assert.equal(assignMissingManualPersonIds(legacy), true)
  const identities = legacy.videos[0].segments.map(item => item.humanAnnotation!.persons[0].personId)
  assert.deepEqual(identities, ['video-1:manual-person:1', 'video-1:manual-person:2'])
  assert.equal(assignMissingManualPersonIds(legacy), false)
})

test('conflict detection rejects ambiguous same-entity keys but keeps person/object namespaces separate', () => {
  const source = annotation(1)
  source.persons = [
    { ...drawPerson(task()).task.videos[0].segments[0].humanAnnotation!.persons[0], trackId: 4 },
    { ...drawPerson(task()).task.videos[0].segments[0].humanAnnotation!.persons[0], trackId: 4 },
  ]
  source.objects = [{
    trackId: 4,
    name: 'bag',
    category: 'other',
    color: 'unknown',
    brand: null,
    bbox: { x: 50, y: 50, width: 20, height: 20 },
    depth: null,
  }]
  source.frames![0].observations = [
    { trackId: 4, entityType: 'person', className: 'person', bbox: { x: 1, y: 1, width: 10, height: 10 }, source: 'manual' },
    { trackId: 4, entityType: 'person', className: 'person', bbox: { x: 2, y: 2, width: 10, height: 10 }, source: 'manual' },
    { trackId: 4, entityType: 'object', className: 'bag', bbox: { x: 3, y: 3, width: 10, height: 10 }, source: 'manual' },
  ]

  const conflicts = findAnnotationTrackConflicts(source)
  assert.equal(conflicts.length, 2)
  assert.ok(conflicts.some(value => value.includes('duplicates person Track 4')))
  assert.ok(conflicts.some(value => value.includes('duplicates person:4')))
})
