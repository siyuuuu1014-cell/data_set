import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAnnotationOptions,
  precisionAvailabilityError,
} from '../../services/video-annotation/annotation-options'
import type { DeploymentStatus } from '../../services/video-annotation/types'

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
