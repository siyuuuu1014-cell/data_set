import assert from 'node:assert/strict'
import test from 'node:test'

import { applyCompletedModelResult, applyIdentityAliasesToVideo } from '../../services/video-annotation/model-result'
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
