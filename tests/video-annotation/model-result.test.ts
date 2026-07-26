import assert from 'node:assert/strict'
import test from 'node:test'

import { applyCompletedModelResult } from '../../services/video-annotation/model-result'
import type {
  SegmentAnnotation,
  SegmentState,
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
