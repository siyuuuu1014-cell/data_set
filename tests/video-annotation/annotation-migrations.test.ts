import assert from 'node:assert/strict'
import test from 'node:test'
import { repairLegacyOcrObjectCollisions } from '../../services/video-annotation/annotation-migrations'
import type { FrameAnnotation, ObjectAnnotation, SegmentAnnotation } from '../../services/video-annotation/types'

const box = (x: number) => ({ x, y: 10, width: 100, height: 100 })

function object(
  trackId: number,
  name: string,
  extra: Partial<ObjectAnnotation> = {},
): ObjectAnnotation {
  return {
    trackId,
    name,
    category: 'animal',
    color: 'unknown',
    brand: null,
    bbox: box(0),
    depth: null,
    ...extra,
  }
}

function frame(
  frameIndex: number,
  timestamp: number,
  observations: FrameAnnotation['observations'],
): FrameAnnotation {
  return {
    frameIndex,
    timestamp,
    imageWidth: 400,
    imageHeight: 300,
    observations,
  }
}

function annotation(
  objects: ObjectAnnotation[],
  frames: FrameAnnotation[],
): SegmentAnnotation {
  return {
    segmentId: 1,
    start: 0,
    end: 2,
    scene: { tags: [], place: { type: 'outdoor', indoor: false, weather: null, lighting: 'bright', timeOfDay: 'unknown' } },
    camera: { shot: 'unknown', angle: 'eye_level', movement: [], lens: 'unknown', stabilization: 'unknown' },
    persons: [],
    objects,
    events: [],
    frames,
  }
}

test('legacy OCR collision is split and safely relinked to an adjacent object track', () => {
  const human = annotation(
    [
      object(3, 'bird', { bbox: box(12) }),
      object(5, 'chicken', { bbox: box(10), _textContent: 'VAMN' }),
    ],
    [
      frame(0, 0, [
        { trackId: 5, entityType: 'object', className: 'chicken', bbox: box(10), source: 'manual' },
      ]),
      frame(15, 0.5, [
        { trackId: 3, entityType: 'object', className: 'bird', bbox: box(12), source: 'model' },
      ]),
    ],
  )
  const model = annotation(
    [
      object(3, 'bird', { bbox: box(12) }),
      object(1_000_000, 'VAMN', { category: 'text', _textContent: 'VAMN', bbox: box(200) }),
      object(1_000_001, 'AN', { category: 'text', _textContent: 'AN', bbox: box(250) }),
    ],
    [
      frame(0, 0, [
        { trackId: 1_000_000, entityType: 'object', className: 'VAMN', bbox: box(200), source: 'model' },
        { trackId: 1_000_001, entityType: 'object', className: 'AN', bbox: box(250), source: 'model' },
      ]),
      frame(15, 0.5, [
        { trackId: 3, entityType: 'object', className: 'bird', bbox: box(12), source: 'model' },
      ]),
    ],
  )

  const migrated = repairLegacyOcrObjectCollisions(human, model)
  assert.equal(migrated.changed, true)
  assert.deepEqual(migrated.annotation.objects.map(item => item.trackId), [3, 1_000_000, 1_000_001])
  assert.equal(migrated.annotation.objects.some(item => item.trackId === 5), false)
  assert.deepEqual(
    migrated.annotation.frames?.[0].observations.map(item => [item.trackId, item.className]),
    [[3, 'chicken'], [1_000_000, 'VAMN'], [1_000_001, 'AN']],
  )

  const secondPass = repairLegacyOcrObjectCollisions(migrated.annotation, model)
  assert.equal(secondPass.changed, false)
  assert.strictEqual(secondPass.annotation, migrated.annotation)
})

test('ambiguous legacy object relinking is refused while OCR metadata is still separated', () => {
  const human = annotation(
    [
      object(3, 'bird', { bbox: box(12) }),
      object(4, 'bird', { bbox: box(14) }),
      object(5, 'chicken', { bbox: box(10), _textContent: 'VAMN' }),
    ],
    [
      frame(0, 0, [
        { trackId: 5, entityType: 'object', className: 'chicken', bbox: box(10), source: 'manual' },
      ]),
      frame(15, 0.5, [
        { trackId: 3, entityType: 'object', className: 'bird', bbox: box(12), source: 'model' },
        { trackId: 4, entityType: 'object', className: 'bird', bbox: box(14), source: 'model' },
      ]),
    ],
  )
  const model = annotation(
    [object(1_000_000, 'VAMN', { category: 'text', _textContent: 'VAMN' })],
    [],
  )

  const migrated = repairLegacyOcrObjectCollisions(human, model)
  const retained = migrated.annotation.objects.find(item => item.trackId === 5)
  assert.ok(retained)
  assert.equal(retained._textContent, undefined)
  assert.equal(migrated.annotation.frames?.[0].observations[0].trackId, 5)
  assert.ok(migrated.annotation.objects.some(item => item.trackId >= 1_000_000 && item._textContent === 'VAMN'))
})
