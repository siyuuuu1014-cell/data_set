import assert from 'node:assert/strict'
import test from 'node:test'
import { clampBox, convertEntityType, fillEmptyPersonAttributes, frameDisplayEntities, legacyFrame, nextTrackId, renameObjectLabel, replaceObservation, upsertFrame } from '../../services/video-annotation/frame-annotations'
import { exportCurrentFrameJson, exportCustomJson } from '../../services/video-annotation/export-service'
import { prepareSegmentAnnotationForReview, validateSegmentAnnotationReview, withAuthoritativeSegmentMetadata } from '../../services/video-annotation/json-review'
import type { SegmentAnnotation } from '../../services/video-annotation/types'

const annotation: SegmentAnnotation = {
  segmentId: 1,
  start: 10,
  end: 12,
  scene: { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } },
  camera: { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' },
  persons: [{
    trackId: 1, personId: null, gender: 'unknown', ageGroup: 'unknown',
    hair: { color: 'unknown', style: 'unknown' }, expression: 'unknown', pose: 'unknown',
    action: [], facing: 'unknown', occlusion: 0, clothing: [],
    bbox: { x: 1, y: 2, width: 30, height: 40 }, depth: null, keypoints: [],
  }],
  objects: [{
    trackId: 1, name: 'cup', category: 'other', color: 'unknown', brand: null,
    bbox: { x: 50, y: 60, width: 20, height: 20 }, depth: null,
  }],
  events: [],
}

test('frame observations keep person and object with the same track id separate', () => {
  const frame = legacyFrame(annotation, 11, 24, 100, 100)
  const resized = replaceObservation(frame, { entityType: 'object', trackId: 1 }, item => ({
    ...item,
    bbox: { x: 70, y: 70, width: 10, height: 10 },
  }))
  const display = frameDisplayEntities(annotation, resized)
  assert.deepEqual(display.persons[0].bbox, { x: 1, y: 2, width: 30, height: 40 })
  assert.deepEqual(display.objects[0].bbox, { x: 70, y: 70, width: 10, height: 10 })
})

test('frame edits are clamped and track allocation scans both entity types', () => {
  assert.deepEqual(clampBox({ x: -5, y: 95, width: 200, height: 20 }, 100, 100), {
    x: 0, y: 95, width: 100, height: 5,
  })
  assert.equal(nextTrackId(annotation), 2)
})

test('targeted person suggestions fill only empty semantic fields', () => {
  const reviewed = {
    ...annotation.persons[0],
    gender: 'female',
    action: ['reviewed_action'],
    occlusion: 0,
  }
  const result = fillEmptyPersonAttributes(reviewed, {
    gender: 'male',
    ageGroup: 'young_adult',
    hair: { color: 'red', style: 'long' },
    expression: 'smiling',
    pose: 'standing',
    action: ['standing'],
    facing: 'front',
    occlusion: 0.5,
    clothing: [{ type: 'jacket', color: 'pink', attributes: [], brand: null }],
  })
  assert.equal(result.gender, 'female')
  assert.equal(result.ageGroup, 'young_adult')
  assert.deepEqual(result.action, ['reviewed_action'])
  assert.equal(result.occlusion, 0)
  assert.deepEqual(result.hair, { color: 'red', style: 'long' })
  assert.equal(result.clothing[0].type, 'jacket')
  assert.equal(result.personId, reviewed.personId)
  assert.deepEqual(result.bbox, reviewed.bbox)
})

test('upsert replaces one frame without changing neighbouring frames', () => {
  const first = legacyFrame(annotation, 10, 10, 100, 100)
  const second = legacyFrame(annotation, 11, 10, 100, 100)
  const withFrames = upsertFrame(upsertFrame(annotation, first), second)
  const changed = { ...second, observations: [] }
  const result = upsertFrame(withFrames, changed)
  assert.equal(result.frames?.length, 2)
  assert.equal(result.frames?.[0].observations.length, 2)
  assert.equal(result.frames?.[1].observations.length, 0)
})

test('segment review JSON keeps review content and strips runtime-only diagnostics', () => {
  const frame = legacyFrame(annotation, 11, 24, 100, 100)
  const reviewed = prepareSegmentAnnotationForReview({
    ...annotation,
    persons: annotation.persons.map(person => ({ ...person, _className: 'person', _detectionConfidence: 0.91 })),
    objects: [{
      trackId: 1_000_000,
      name: '字幕',
      category: 'text',
      color: 'white',
      brand: null,
      bbox: null,
      depth: null,
      _textContent: '人工字幕',
      _detectionConfidence: 0.88,
    }],
    events: [{ type: '[Speech] legacy words', confidence: 0.9 }],
    frames: [frame],
    _recognition: { ocr: { status: 'completed', count: 1 } },
    _provider_statuses: { yolo: { status: 'completed' } },
    _pipeline_status: 'completed',
  }) as SegmentAnnotation & Record<string, unknown>

  assert.equal(reviewed.speechTranscript, 'legacy words')
  assert.equal(reviewed.objects[0]._textContent, '人工字幕')
  assert.equal(reviewed.frames?.length, 1)
  assert.equal(reviewed._recognition, undefined)
  assert.equal(reviewed._provider_statuses, undefined)
  assert.equal(reviewed._pipeline_status, undefined)
  assert.equal(reviewed.persons[0]._detectionConfidence, undefined)
  assert.equal(reviewed.objects[0]._detectionConfidence, undefined)
})

test('segment review metadata always comes from the selected outer segment', () => {
  const stale = { ...annotation, segmentId: undefined, start: undefined, end: undefined } as unknown as SegmentAnnotation
  const metadata = { segmentId: 3, start: 2.933312, end: 3.766688 }

  const reviewed = prepareSegmentAnnotationForReview(stale, metadata)
  assert.equal(reviewed.segmentId, 3)
  assert.equal(reviewed.start, 2.933312)
  assert.equal(reviewed.end, 3.766688)

  const attemptedEdit = withAuthoritativeSegmentMetadata(
    { ...annotation, segmentId: 99, start: 100, end: 101 },
    metadata,
  )
  assert.equal(attemptedEdit.segmentId, 3)
  assert.equal(attemptedEdit.start, 2.933312)
  assert.equal(attemptedEdit.end, 3.766688)
  assert.deepEqual(validateSegmentAnnotationReview(attemptedEdit), [])
})

test('segment review JSON validation rejects unsafe whole-annotation replacements', () => {
  assert.deepEqual(validateSegmentAnnotationReview(annotation), [])

  const errors = validateSegmentAnnotationReview({
    ...annotation,
    end: 9,
    persons: [{ ...annotation.persons[0], trackId: 'one', bbox: { x: 0, y: 0, width: 'wide', height: 10 } }],
    objects: 'not-an-array',
    frames: [{ frameIndex: 10, timestamp: 'late', observations: null }],
  })
  assert.ok(errors.includes('end must be greater than start'))
  assert.ok(errors.includes('persons[0].trackId must be a finite number'))
  assert.ok(errors.includes('persons[0].bbox.width must be a finite number'))
  assert.ok(errors.includes('objects must be an array'))
  assert.ok(errors.includes('frames[0].timestamp must be a finite number'))
  assert.ok(errors.includes('frames[0].observations must be an array'))
})

test('custom JSON normalizes labels and omits speech, OCR, and frame observations', () => {
  const frame = legacyFrame(annotation, 11, 24, 100, 100)
  const exported = JSON.parse(exportCustomJson([{
    video: { videoId: 'v1', filePath: 'v1.mp4', duration: 12, fps: 24, width: 100, height: 100, description: '' },
    annotations: [{
      ...annotation,
      speechTranscript: 'spoken words',
      scene: { ...annotation.scene, tags: ['Living Room'], place: { ...annotation.scene.place, type: 'living-room', timeOfDay: 'Late Afternoon' } },
      camera: { ...annotation.camera, angle: 'eye-level', movement: ['slow push in'] },
      persons: annotation.persons.map(person => ({ ...person, action: ['Play Piano'] })),
      objects: [
        ...annotation.objects.map(object => ({ ...object, name: 'Coffee Cup' })),
        { trackId: 2, name: 'subtitle', category: 'text', color: 'white', brand: null, bbox: null, depth: null, _textContent: 'hello' },
      ],
      events: [{ type: 'Music Performance', description: 'A person plays music.', confidence: 0.9 }],
      frames: [frame],
    }],
  }])) as Array<{ annotations: Array<Record<string, unknown>> }>
  const segment = exported[0].annotations[0] as {
    scene: { tags: string[]; place: { type: string; timeOfDay: string } }
    camera: { angle: string; movement: string[] }
    persons: Array<{ action: string[] }>
    objects: Array<{ name: string }>
    events: Array<{ type: string; description?: string }>
    speechTranscript?: string
    frames?: unknown[]
  }
  assert.deepEqual(segment.scene.tags, ['living_room'])
  assert.equal(segment.scene.place.type, 'living_room')
  assert.equal(segment.scene.place.timeOfDay, 'late_afternoon')
  assert.equal(segment.camera.angle, 'eye_level')
  assert.deepEqual(segment.camera.movement, ['slow_push_in'])
  assert.deepEqual(segment.persons[0].action, ['play_piano'])
  assert.deepEqual(segment.objects.map(object => object.name), ['coffee_cup'])
  assert.equal(segment.events[0].type, 'music_performance')
  assert.equal(segment.events[0].description, 'A person plays music.')
  assert.equal(segment.speechTranscript, undefined)
  assert.equal(segment.frames, undefined)
})

test('custom JSON can include OCR and speech without restoring frames or diagnostics', () => {
  const frame = legacyFrame(annotation, 11, 24, 100, 100)
  const exported = JSON.parse(exportCustomJson([{
    video: { videoId: 'v1', filePath: 'v1.mp4', duration: 12, fps: 24, width: 100, height: 100, description: '' },
    annotations: [{
      ...annotation,
      speechTranscript: ' Keep this corrected transcript. ',
      objects: [
        ...annotation.objects,
        {
          trackId: 1_000_000,
          name: '旧识别内容',
          category: 'text',
          color: 'White',
          brand: null,
          bbox: { x: 5, y: 80, width: 90, height: 10 },
          depth: null,
          _textContent: '人工修正：Hello, 世界！',
          _detectionConfidence: 0.99,
        },
      ],
      frames: [frame],
      _provider_statuses: { qwen_vl: { status: 'completed' } },
      _pipeline_status: 'completed',
    }],
  }], {
    includeOcr: true,
    includeSpeechTranscript: true,
  }))[0].annotations[0]

  assert.equal(exported.speechTranscript, ' Keep this corrected transcript. ')
  assert.equal(exported.objects.length, 2)
  assert.deepEqual(exported.objects[1], {
    trackId: 1_000_000,
    name: '人工修正：Hello, 世界！',
    category: 'text',
    color: 'white',
    brand: null,
    bbox: { x: 5, y: 80, width: 90, height: 10 },
    depth: null,
    _textContent: '人工修正：Hello, 世界！',
  })
  assert.equal(exported.frames, undefined)
  assert.equal(exported._provider_statuses, undefined)
  assert.equal(exported._pipeline_status, undefined)
})

test('custom JSON safely exports sparse legacy and manually edited labels', () => {
  const sparseSegment = {
    segmentId: 1,
    start: 0,
    end: 1,
    scene: {
      tags: [undefined, '', 'Living Room'],
      place: { indoor: true },
    },
    camera: { movement: [undefined, '', 'Pan Left'] },
    persons: [{
      trackId: 1,
      personId: null,
      hair: undefined,
      action: undefined,
      clothing: [{ attributes: undefined }],
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      keypoints: undefined,
    }],
    objects: [{
      trackId: 2,
      bbox: { x: 20, y: 0, width: 10, height: 10 },
      depth: null,
    }],
    events: [{ confidence: 0.5 }],
  } as unknown as SegmentAnnotation

  const exported = JSON.parse(exportCustomJson([{
    video: { videoId: 'legacy', filePath: 'legacy.mp4', duration: 1, fps: 24, width: 100, height: 100, description: '' },
    annotations: [sparseSegment],
  }]))[0].annotations[0]

  assert.deepEqual(exported.scene.tags, ['living_room'])
  assert.deepEqual(exported.scene.place, {
    type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown',
  })
  assert.deepEqual(exported.camera.movement, ['pan_left'])
  assert.equal(exported.camera.shot, 'unknown')
  assert.equal(exported.persons[0].gender, 'unknown')
  assert.deepEqual(exported.persons[0].hair, { color: 'unknown', style: 'unknown' })
  assert.deepEqual(exported.persons[0].action, [])
  assert.deepEqual(exported.persons[0].clothing[0].attributes, [])
  assert.equal(exported.objects[0].name, 'unknown')
  assert.equal(exported.objects[0].category, 'unknown')
  assert.equal(exported.events[0].type, 'unknown')
})

test('current-frame JSON contains only visible non-OCR entities and recomputes its event', () => {
  const currentFrame = {
    frameIndex: 0,
    timestamp: 0,
    imageWidth: 1920,
    imageHeight: 1080,
    observations: [
      { trackId: 1, entityType: 'object' as const, className: 'chicken', bbox: { x: 10, y: 20, width: 30, height: 40 }, confidence: 0.8, source: 'manual' as const },
      { trackId: 2, entityType: 'object' as const, className: 'chicken', bbox: { x: 50, y: 20, width: 30, height: 40 }, confidence: 0.8, source: 'manual' as const },
      { trackId: 5, entityType: 'object' as const, className: 'chicken', bbox: { x: 90, y: 20, width: 30, height: 40 }, confidence: 0.8, source: 'manual' as const },
      { trackId: 1_000_000, entityType: 'object' as const, className: 'subtitle', bbox: { x: 0, y: 80, width: 100, height: 10 }, confidence: 0.9, source: 'model' as const },
    ],
  }
  const laterFrame = {
    ...currentFrame,
    frameIndex: 30,
    timestamp: 1,
    observations: [
      { trackId: 3, entityType: 'object' as const, className: 'bird', bbox: { x: 130, y: 20, width: 30, height: 40 }, confidence: 0.8, source: 'model' as const },
    ],
  }
  const objects = [
    ...[1, 2, 3, 5].map(trackId => ({
      trackId, name: 'chicken', category: 'animal', color: 'unknown', brand: null,
      bbox: { x: 0, y: 0, width: 1, height: 1 }, depth: null,
    })),
    {
      // Historical OCR pollution may carry a non-text category; the explicit
      // text payload must still keep it out of a frame export.
      trackId: 1_000_000, name: 'subtitle', category: 'animal', color: 'white', brand: null,
      bbox: { x: 0, y: 80, width: 100, height: 10 }, depth: null, _textContent: 'subtitle',
    },
  ]
  const result = JSON.parse(exportCurrentFrameJson({
    ...annotation,
    objects,
    speechTranscript: 'not part of a frame export',
    events: [{ type: 'bird', description: 'Stale segment event.', confidence: 0.9 }],
    frames: [currentFrame, laterFrame],
  }, currentFrame)) as {
    frameIndex: number
    timestamp: number
    objects: Array<{ trackId: number; name: string; bbox: { x: number } }>
    events: Array<{ type: string; description: string }>
    speechTranscript?: string
    frames?: unknown[]
  }

  assert.equal(result.frameIndex, 0)
  assert.equal(result.timestamp, 0)
  assert.deepEqual(result.objects.map(object => object.trackId), [1, 2, 5])
  assert.deepEqual(result.objects.map(object => object.name), ['chicken', 'chicken', 'chicken'])
  assert.equal(result.objects[0].bbox.x, 10)
  assert.equal(result.events[0].type, 'visual_activity')
  assert.equal(result.events[0].description, 'The frame shows three chickens.')
  assert.equal(result.speechTranscript, undefined)
  assert.equal(result.frames, undefined)
})

test('renaming one object track synchronizes every observation for that track', () => {
  const first = {
    frameIndex: 0,
    timestamp: 0,
    imageWidth: 100,
    imageHeight: 100,
    observations: [
      { trackId: 1, entityType: 'object' as const, className: 'bird', bbox: { x: 0, y: 0, width: 10, height: 10 }, source: 'model' as const },
      { trackId: 2, entityType: 'object' as const, className: 'bird', bbox: { x: 20, y: 0, width: 10, height: 10 }, source: 'model' as const },
    ],
  }
  const second = { ...first, frameIndex: 10, timestamp: 1 }
  const result = renameObjectLabel({
    ...annotation,
    persons: [],
    objects: [
      { ...annotation.objects[0], trackId: 1, name: 'bird' },
      { ...annotation.objects[0], trackId: 2, name: 'bird' },
    ],
    events: [{ type: 'visual_activity', description: 'The frame shows bird.', confidence: 0.6 }],
    frames: [first, second],
  }, 1, 'bird', 'chicken', 'track')

  assert.equal(result.objects.find(object => object.trackId === 1)?.name, 'chicken')
  assert.equal(result.objects.find(object => object.trackId === 2)?.name, 'bird')
  assert.equal(result.frames?.every(frame => frame.observations[0].className === 'chicken'), true)
  assert.equal(result.frames?.every(frame => frame.observations[1].className === 'bird'), true)
  assert.equal(result.events[0].description, 'The segment shows a chicken and a bird.')
})

test('frame label correction changes only the selected frame and drives frame JSON', () => {
  const first = {
    frameIndex: 10,
    timestamp: 1,
    imageWidth: 100,
    imageHeight: 100,
    observations: [
      { trackId: 1, entityType: 'object' as const, className: 'bird', bbox: { x: 0, y: 0, width: 10, height: 10 }, source: 'model' as const },
    ],
  }
  const second = { ...first, frameIndex: 20, timestamp: 2 }
  const source: SegmentAnnotation = {
    ...annotation,
    persons: [],
    objects: [{ ...annotation.objects[0], trackId: 1, name: 'bird', category: 'animal' }],
    events: [{ type: 'visual_activity', description: 'The segment shows a bird.', confidence: 0.6 }],
    frames: [first, second],
  }
  const result = renameObjectLabel(source, 1, 'bird', 'chicken', 'frame', first.frameIndex)

  assert.equal(result.objects[0].name, 'bird')
  assert.equal(result.frames?.[0].observations[0].className, 'chicken')
  assert.equal(result.frames?.[0].observations[0].source, 'manual')
  assert.equal(result.frames?.[1].observations[0].className, 'bird')
  assert.equal(result.events[0].description, 'The segment shows a bird.')

  const firstExport = JSON.parse(exportCurrentFrameJson(result, result.frames![0]))
  const secondExport = JSON.parse(exportCurrentFrameJson(result, result.frames![1]))
  assert.equal(firstExport.objects[0].name, 'chicken')
  assert.equal(firstExport.events[0].description, 'The frame shows one chicken.')
  assert.equal(secondExport.objects[0].name, 'bird')
})

test('matching-segment rename reconciles fragmented tracks without changing OCR or human events', () => {
  const frame = {
    frameIndex: 0,
    timestamp: 0,
    imageWidth: 100,
    imageHeight: 100,
    observations: [
      // A previous track-only save has already changed the selected human
      // observation, while the preserved model annotation still says bird.
      { trackId: 1, entityType: 'object' as const, className: 'chicken', bbox: { x: 0, y: 0, width: 10, height: 10 }, source: 'manual' as const },
      { trackId: 2, entityType: 'object' as const, className: 'bird', bbox: { x: 20, y: 0, width: 10, height: 10 }, source: 'model' as const },
      { trackId: 3, entityType: 'object' as const, className: 'bird', bbox: { x: 40, y: 0, width: 10, height: 10 }, source: 'model' as const },
      { trackId: 1_000_000, entityType: 'object' as const, className: 'bird', bbox: { x: 60, y: 0, width: 10, height: 10 }, source: 'model' as const },
    ],
  }
  const result = renameObjectLabel({
    ...annotation,
    persons: [],
    objects: [
      // The review summary may already contain the corrected label too.
      { ...annotation.objects[0], trackId: 1, name: 'chicken' },
      { ...annotation.objects[0], trackId: 2, name: 'bird' },
      { ...annotation.objects[0], trackId: 3, name: 'chicken' },
      { ...annotation.objects[0], trackId: 1_000_000, name: 'bird', category: 'text', _textContent: 'bird' },
    ],
    events: [
      { type: 'music_performance', description: 'Human-reviewed event.', confidence: 0.9 },
      { type: 'visual_activity', description: 'The frame shows bird.', confidence: 0.6 },
    ],
    frames: [frame],
  }, 1, ['chicken', 'bird'], 'chicken', 'matching_segment')

  assert.deepEqual(
    result.objects.filter(object => object.category !== 'text').map(object => object.name),
    ['chicken', 'chicken', 'chicken'],
  )
  assert.equal(result.objects.find(object => object.category === 'text')?.name, 'bird')
  assert.deepEqual(
    result.frames?.[0].observations.map(observation => observation.className),
    ['chicken', 'chicken', 'chicken', 'bird'],
  )
  assert.equal(result.events[0].description, 'Human-reviewed event.')
  assert.equal(result.events[1].description, 'The segment shows chickens.')
})

test('current-frame conversion preserves the source type in neighbouring frames', () => {
  const first = legacyFrame({ ...annotation, objects: [] }, 10, 10, 100, 100)
  const second = legacyFrame({ ...annotation, objects: [] }, 11, 10, 100, 100)
  const withFrames = { ...annotation, objects: [], frames: [first, second] }
  const converted = convertEntityType(
    withFrames,
    { entityType: 'person', trackId: 1 },
    'object',
    'frame',
    first.frameIndex,
    'statue',
  )

  assert.equal(converted.frames?.[0].observations[0].entityType, 'object')
  assert.equal(converted.frames?.[0].observations[0].className, 'statue')
  assert.equal(converted.frames?.[1].observations[0].entityType, 'person')
  assert.equal(converted.persons.length, 1)
  assert.equal(converted.objects[0].name, 'statue')
})

test('entire-track conversion removes the obsolete segment summary', () => {
  const first = legacyFrame({ ...annotation, objects: [] }, 10, 10, 100, 100)
  const second = legacyFrame({ ...annotation, objects: [] }, 11, 10, 100, 100)
  const converted = convertEntityType(
    { ...annotation, objects: [], frames: [first, second] },
    { entityType: 'person', trackId: 1 },
    'object',
    'track',
    null,
    'statue',
  )

  assert.equal(converted.frames?.every(frame => frame.observations[0].entityType === 'object'), true)
  assert.equal(converted.persons.length, 0)
  assert.equal(converted.objects.length, 1)
})

test('object-to-person conversion creates editable default person attributes', () => {
  const objectOnly = { ...annotation, persons: [] }
  const frame = legacyFrame(objectOnly, 10, 10, 100, 100)
  const converted = convertEntityType(
    { ...objectOnly, frames: [frame] },
    { entityType: 'object', trackId: 1 },
    'person',
    'track',
    null,
  )
  assert.equal(converted.objects.length, 0)
  assert.equal(converted.persons[0].gender, 'unknown')
  assert.equal(converted.frames?.[0].observations[0].className, 'person')
})

test('round-trip conversion preserves a video person identity', () => {
  const identified = {
    ...annotation,
    objects: [],
    persons: annotation.persons.map(person => ({ ...person, personId: 'video-1:person:7' })),
  }
  const frame = legacyFrame(identified, 10, 10, 100, 100)
  const asObject = convertEntityType(
    { ...identified, frames: [frame] },
    { entityType: 'person', trackId: 1 },
    'object',
    'track',
    null,
    'statue',
  )
  assert.equal(asObject.objects[0]._convertedPersonId, 'video-1:person:7')
  const asPerson = convertEntityType(
    asObject,
    { entityType: 'object', trackId: 1 },
    'person',
    'track',
    null,
  )
  assert.equal(asPerson.persons[0].personId, 'video-1:person:7')
})
