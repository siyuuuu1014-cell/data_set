import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAnnotationOptions,
  buildReviewTrackCandidates,
  precisionAvailabilityError,
} from '../../services/video-annotation/annotation-options'
import type { DeploymentStatus, SegmentAnnotation, SegmentState } from '../../services/video-annotation/types'

function deployment(
  mode: DeploymentStatus['mode'],
  setupStatus: DeploymentStatus['enhancedSetup']['status'],
): DeploymentStatus {
  return {
    mode,
    managedByEnvironment: false,
    huggingFace: {
      authenticated: false,
      source: null,
      username: null,
      error: null,
    },
    enhancedSetup: {
      status: setupStatus,
      phase: setupStatus === 'ready' ? 'ready' : null,
      error: null,
      updatedAt: null,
      model: 'nvidia/LocateAnything-3B',
      modelUrl: 'https://huggingface.co/nvidia/LocateAnything-3B',
      providerStatus: setupStatus === 'ready' ? 'ready' : 'disabled',
      providerReason: null,
      cacheRoot: 'cache',
      localModelPath: setupStatus === 'ready' ? 'snapshot' : null,
      downloadRequired: setupStatus !== 'ready',
      approximateDownloadGb: 7.2,
    },
  }
}

test('standard annotation explicitly disables LocateAnything for the job', () => {
  const options = buildAnnotationOptions({
    videoId: 'video-1',
    segmentId: 13,
    mode: 'standard',
  })

  assert.deepEqual(options.providers, { locate_anything: false })
  assert.equal(options.tracking_fps, 3)
  assert.equal(options.sample_fps, 0.5)
})

test('precision annotation enables LocateAnything only for the selected job', () => {
  const options = buildAnnotationOptions({
    videoId: 'video-1',
    segmentId: 13,
    mode: 'precision',
  })

  assert.deepEqual(options.providers, { locate_anything: true })
})

test('segment re-run carries only human-drawn boxes as semantic review candidates', () => {
  const annotation: SegmentAnnotation = {
    segmentId: 13, start: 10, end: 12,
    scene: { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } },
    camera: { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' },
    persons: [{
      trackId: 1000002, personId: 'video-1:manual-person:1', gender: 'unknown', ageGroup: 'unknown',
      hair: { color: 'unknown', style: 'unknown' }, expression: 'unknown', pose: 'unknown', action: [],
      facing: 'unknown', occlusion: 0, clothing: [], bbox: { x: 10, y: 20, width: 30, height: 40 },
      depth: null, keypoints: [], _className: 'manual',
    }],
    objects: [], events: [],
    frames: [{
      frameIndex: 300, timestamp: 10, imageWidth: 640, imageHeight: 360,
      observations: [{
        trackId: 1000002, entityType: 'person', className: 'person',
        bbox: { x: 10, y: 20, width: 30, height: 40 }, source: 'manual',
      }],
    }],
  }
  const segment: SegmentState = {
    segmentId: 13, start: 10, end: 12, status: 'completed',
    modelAnnotation: null, humanAnnotation: annotation,
  }

  assert.deepEqual(buildReviewTrackCandidates(segment), [{
    trackId: 1000002, entityType: 'person', className: 'person',
    bbox: { x: 10, y: 20, width: 30, height: 40 },
    timestamp: 10, imageWidth: 640, imageHeight: 360,
    personId: 'video-1:manual-person:1',
  }])
})

test('precision annotation requires a ready enhanced deployment', () => {
  assert.match(
    precisionAvailabilityError(deployment('standard', 'idle')) || '',
    /enhanced deployment mode/i,
  )
  assert.match(
    precisionAvailabilityError(deployment('enhanced', 'downloading')) || '',
    /not ready/i,
  )
  assert.equal(
    precisionAvailabilityError(deployment('enhanced', 'ready')),
    null,
  )
})
