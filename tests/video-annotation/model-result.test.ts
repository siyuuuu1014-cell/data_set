import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyCompletedModelResult,
  applyIdentityAliasesToVideo,
  reconcileEmptyHumanEntityAttributes,
} from '../../services/video-annotation/model-result'
import type {
  SegmentAnnotation,
  SegmentState,
  VideoTaskItem,
} from '../../services/video-annotation/types'

function annotation(
  pipelineStatus: 'completed' | 'partial_completed' = 'completed',
  errors?: string[],
): SegmentAnnotation {
  return {
    segmentId: 1,
    start: 0,
    end: 1,
    scene: {
      tags: [],
      place: {
        type: 'unknown',
        indoor: true,
        weather: null,
        lighting: 'unknown',
        timeOfDay: 'unknown',
      },
    },
    camera: {
      shot: 'unknown',
      angle: 'unknown',
      movement: [],
      lens: 'unknown',
      stabilization: 'unknown',
    },
    persons: [],
    objects: [],
    events: [],
    _pipeline_status: pipelineStatus,
    _pipeline_errors: errors,
  }
}

test('completed model results preserve human-reviewed annotations', () => {
  const human = { ...annotation(), _humanEdited: true }
  const segment: SegmentState = {
    segmentId: 1,
    start: 0,
    end: 1,
    status: 'processing',
    modelAnnotation: null,
    humanAnnotation: human,
    progressPhase: 'Qwen',
    processingMode: 'precision',
  }
  const model = annotation('completed')

  applyCompletedModelResult(segment, model)

  assert.equal(segment.modelAnnotation, model)
  assert.equal(segment.humanAnnotation, human)
  assert.equal(segment.status, 'completed')
  assert.equal(segment.progressPhase, undefined)
  assert.equal(segment.lastCompletedMode, 'precision')
  assert.equal(segment.processingMode, undefined)
})

test('partial model results retain diagnostics without touching human data', () => {
  const human = { ...annotation(), _humanEdited: true }
  const segment: SegmentState = {
    segmentId: 1,
    start: 0,
    end: 1,
    status: 'processing',
    modelAnnotation: null,
    humanAnnotation: human,
  }

  applyCompletedModelResult(
    segment,
    annotation('partial_completed', ['tracker failed', 'qwen failed']),
  )

  assert.equal(segment.status, 'partial_completed')
  assert.equal(segment.error, 'tracker failed; qwen failed')
  assert.equal(segment.humanAnnotation, human)
})

test('a clean rerun clears stale model errors', () => {
  const segment: SegmentState = {
    segmentId: 1,
    start: 0,
    end: 1,
    status: 'failed',
    modelAnnotation: null,
    humanAnnotation: null,
    error: 'old failure',
  }

  applyCompletedModelResult(segment, annotation())

  assert.equal(segment.status, 'completed')
  assert.equal(segment.error, undefined)
  assert.equal(segment.lastCompletedMode, 'standard')
})

test('new Track-bound semantics fill empty review fields without overwriting reviewed values', () => {
  const human = annotation()
  human.persons = [{
    trackId: 9,
    personId: 'video-1:person:4',
    gender: 'unknown',
    ageGroup: 'adult',
    hair: { color: 'red', style: 'unknown' },
    expression: 'unknown',
    pose: 'unknown',
    action: [],
    facing: 'unknown',
    occlusion: 0.25,
    clothing: [],
    bbox: { x: 1, y: 2, width: 30, height: 40 },
    depth: null,
    keypoints: [],
  }]
  human.objects = [{
    trackId: 3,
    name: 'book',
    category: 'unknown',
    color: 'unknown',
    brand: null,
    bbox: { x: 2, y: 3, width: 10, height: 12 },
    depth: null,
  }]
  const model = annotation()
  model.persons = [{
    ...human.persons[0],
    gender: 'female',
    ageGroup: 'teen',
    hair: { color: 'black', style: 'long' },
    action: ['reading'],
    occlusion: 0.9,
    clothing: [{ type: 'jacket', color: 'pink', attributes: [], brand: null }],
  }]
  model.objects = [{
    ...human.objects[0],
    name: 'novel',
    category: 'media',
    color: 'blue',
    brand: 'Example',
  }]

  reconcileEmptyHumanEntityAttributes(human, model)

  assert.equal(human.persons[0].gender, 'female')
  assert.equal(human.persons[0].ageGroup, 'adult')
  assert.deepEqual(human.persons[0].hair, { color: 'red', style: 'long' })
  assert.deepEqual(human.persons[0].action, ['reading'])
  assert.equal(human.persons[0].occlusion, 0.25)
  assert.equal(human.persons[0].clothing[0].type, 'jacket')
  assert.equal(human.objects[0].name, 'book')
  assert.equal(human.objects[0].category, 'media')
  assert.equal(human.objects[0].color, 'blue')
  assert.equal(human.objects[0].brand, 'Example')
})

test('unmatched manual entities are never changed by a model rerun', () => {
  const human = annotation()
  human.persons = [{
    trackId: 1_000_002,
    personId: 'video-1:manual-person:11',
    gender: 'unknown',
    ageGroup: 'unknown',
    hair: { color: 'unknown', style: 'unknown' },
    expression: 'unknown',
    pose: 'unknown',
    action: [],
    facing: 'unknown',
    occlusion: 0,
    clothing: [],
    bbox: { x: 1, y: 2, width: 30, height: 40 },
    depth: null,
    keypoints: [],
    _className: 'manual',
  }]

  reconcileEmptyHumanEntityAttributes(human, annotation())

  assert.equal(human.persons[0].gender, 'unknown')
  assert.equal(human.persons[0].personId, 'video-1:manual-person:11')
})

test('identity aliases reconcile model and human annotations across a video', () => {
  const first = annotation()
  first.persons = [{
    trackId: 8,
    personId: 'video-1:person:8',
    gender: 'unknown',
    ageGroup: 'unknown',
    hair: { color: 'unknown', style: 'unknown' },
    expression: 'unknown',
    pose: 'unknown',
    action: [],
    facing: 'unknown',
    occlusion: 0,
    clothing: [],
    bbox: { x: 0, y: 0, width: 10, height: 20 },
    depth: null,
    keypoints: [],
  }]
  const reviewed = structuredClone(first)
  const video: VideoTaskItem = {
    videoId: 'video-1',
    fileName: 'source.mp4',
    filePath: 'source.mp4',
    duration: 2,
    fps: 24,
    width: 100,
    height: 100,
    status: 'completed',
    uploadProgress: 100,
    segments: [{
      segmentId: 1,
      start: 0,
      end: 1,
      status: 'completed',
      modelAnnotation: first,
      humanAnnotation: reviewed,
    }],
  }

  applyIdentityAliasesToVideo(video, {
    'video-1:person:8': 'video-1:person:4',
    'video-1:person:4': 'video-1:person:2',
  })

  assert.equal(video.segments[0].modelAnnotation?.persons[0].personId, 'video-1:person:2')
  assert.equal(video.segments[0].humanAnnotation?.persons[0].personId, 'video-1:person:2')
})

test('identity aliases are consumed as transport metadata instead of persisted annotation data', () => {
  const result = annotation()
  result._identity_aliases = {
    'video-1:person:8': 'video-1:person:2',
  }
  const segment: SegmentState = {
    segmentId: 1,
    start: 0,
    end: 1,
    status: 'processing',
    modelAnnotation: null,
    humanAnnotation: null,
  }

  applyCompletedModelResult(segment, result)

  assert.equal(segment.modelAnnotation?._identity_aliases, undefined)
  assert.deepEqual(result._identity_aliases, {
    'video-1:person:8': 'video-1:person:2',
  })
})

test('re-run suggestions enrich empty manual fields without persisting transport metadata', () => {
  const reviewed = annotation()
  reviewed.persons = [{
    trackId: 1000002,
    personId: 'video-1:manual-person:1',
    gender: 'unknown',
    ageGroup: 'unknown',
    hair: { color: 'unknown', style: 'unknown' },
    expression: 'unknown',
    pose: 'unknown',
    action: [],
    facing: 'unknown',
    occlusion: 0,
    clothing: [],
    bbox: { x: 1, y: 2, width: 30, height: 40 },
    depth: null,
    keypoints: [],
    _className: 'manual',
  }]
  const result = annotation()
  result.persons = []
  result._review_person_suggestions = [{
    trackId: reviewed.persons[0].trackId,
    personId: reviewed.persons[0].personId,
    gender: 'female',
    action: ['smiling'],
  }]
  const segment: SegmentState = {
    segmentId: 1, start: 0, end: 1, status: 'processing',
    modelAnnotation: null, humanAnnotation: reviewed,
  }

  applyCompletedModelResult(segment, result)

  assert.equal(segment.humanAnnotation?.persons[0].gender, 'female')
  assert.deepEqual(segment.humanAnnotation?.persons[0].action, ['smiling'])
  assert.equal(segment.modelAnnotation?._review_person_suggestions, undefined)
})
