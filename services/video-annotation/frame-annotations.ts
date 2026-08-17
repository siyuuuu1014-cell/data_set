import type {
  BBox,
  FrameAnnotation,
  FrameObservation,
  ObjectAnnotation,
  PersonAnnotation,
  SegmentAnnotation,
  SpatialEntityType,
} from './types'
import { deriveGroundedVisualEvent } from './visual-events'

export interface TrackRef {
  entityType: SpatialEntityType
  trackId: number
}

export function trackRefKey(ref: TrackRef): string {
  return `${ref.entityType}:${ref.trackId}`
}

/** Compact UI identity; Track remains the segment-local fallback. */
export function personDisplayId(personId: string | null | undefined, trackId: number): string {
  const manual = personId?.match(/:manual-person:(\d+)$/)
  if (manual) return `P-M${manual[1]}`
  const model = personId?.match(/:person:(\d+)$/)
  if (model) return `P-${model[1]}`
  return `T-${trackId}`
}

function isEmptySemanticLabel(value: string | null | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized || normalized === 'unknown'
}

/** Fill only unreviewed Person fields; identity, bbox, depth, and reviewed values stay untouched. */
export function fillEmptyPersonAttributes(
  person: PersonAnnotation,
  suggestion: Pick<
    PersonAnnotation,
    'gender' | 'ageGroup' | 'hair' | 'expression' | 'pose' | 'action' | 'facing' | 'occlusion' | 'clothing'
  >,
): PersonAnnotation {
  return {
    ...person,
    gender: isEmptySemanticLabel(person.gender) ? suggestion.gender : person.gender,
    ageGroup: isEmptySemanticLabel(person.ageGroup) ? suggestion.ageGroup : person.ageGroup,
    hair: {
      color: isEmptySemanticLabel(person.hair?.color) ? suggestion.hair.color : person.hair.color,
      style: isEmptySemanticLabel(person.hair?.style) ? suggestion.hair.style : person.hair.style,
    },
    expression: isEmptySemanticLabel(person.expression) ? suggestion.expression : person.expression,
    pose: isEmptySemanticLabel(person.pose) ? suggestion.pose : person.pose,
    action: person.action.length === 0 ? [...suggestion.action] : person.action,
    facing: isEmptySemanticLabel(person.facing) ? suggestion.facing : person.facing,
    // Zero is a valid reviewed value as well as the legacy default. Never
    // overwrite it without explicit field-level user input.
    occlusion: person.occlusion,
    clothing: person.clothing.length === 0
      ? suggestion.clothing.map(item => ({ ...item, attributes: [...item.attributes] }))
      : person.clothing,
  }
}

export function clampBox(box: BBox, width: number, height: number): BBox {
  const x = Math.max(0, Math.min(Math.round(box.x), Math.max(0, width - 1)))
  const y = Math.max(0, Math.min(Math.round(box.y), Math.max(0, height - 1)))
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(box.width), width - x)),
    height: Math.max(1, Math.min(Math.round(box.height), height - y)),
  }
}

// Cache sortedness per array reference: playback calls nearestFrame several
// times per second, and re-scanning for sortedness on every call would negate
// the binary search. Arrays are immutable in practice (upsertFrame creates a
// new array), so the cache is safe.
const sortedCache = new WeakMap<FrameAnnotation[], boolean>()

export function nearestFrame(frames: FrameAnnotation[] | undefined, timestamp: number): FrameAnnotation | null {
  if (!frames?.length) return null
  // Frames are kept timestamp-sorted by upsertFrame; binary search is O(log n)
  // instead of the linear scan used on every playback tick. Fall back to a
  // scan if the array is not actually sorted (legacy data).
  let sorted = sortedCache.get(frames)
  if (sorted === undefined) {
    sorted = true
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].timestamp < frames[i - 1].timestamp) { sorted = false; break }
    }
    sortedCache.set(frames, sorted)
  }
  if (!sorted) {
    return frames.reduce((best, frame) => (
      Math.abs(frame.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ? frame : best
    ))
  }
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (frames[mid].timestamp < timestamp) low = mid + 1
    else high = mid
  }
  const candidate = frames[low]
  if (low === 0) return candidate
  const prev = frames[low - 1]
  return Math.abs(candidate.timestamp - timestamp) < Math.abs(prev.timestamp - timestamp) ? candidate : prev
}

export function legacyFrame(
  annotation: SegmentAnnotation,
  timestamp: number,
  fps: number,
  imageWidth: number,
  imageHeight: number,
): FrameAnnotation {
  const observations: FrameObservation[] = [
    ...(annotation.persons || []).map(person => ({
      trackId: person.trackId,
      entityType: 'person' as const,
      className: 'person',
      bbox: person.bbox,
      confidence: person._detectionConfidence,
      source: 'model' as const,
    })),
    ...(annotation.objects || []).flatMap(object => object.bbox ? [{
      trackId: object.trackId,
      entityType: 'object' as const,
      className: object.name || 'object',
      bbox: object.bbox,
      confidence: object._detectionConfidence,
      source: 'model' as const,
    }] : []),
  ]
  return {
    frameIndex: Math.max(0, Math.round(timestamp * Math.max(fps, 1))),
    timestamp,
    imageWidth,
    imageHeight,
    observations,
  }
}

export function frameDisplayEntities(annotation: SegmentAnnotation, frame: FrameAnnotation): {
  persons: PersonAnnotation[]
  objects: ObjectAnnotation[]
} {
  const personsById = new Map((annotation.persons || []).map(item => [item.trackId, item]))
  const objectsById = new Map((annotation.objects || []).map(item => [item.trackId, item]))
  const persons: PersonAnnotation[] = []
  const objects: ObjectAnnotation[] = []

  for (const observation of frame.observations || []) {
    if (observation.entityType === 'person') {
      const summary = personsById.get(observation.trackId)
      persons.push({
        trackId: observation.trackId,
        personId: summary?.personId ?? null,
        gender: summary?.gender ?? 'unknown',
        ageGroup: summary?.ageGroup ?? 'unknown',
        hair: summary?.hair ?? { color: 'unknown', style: 'unknown' },
        expression: summary?.expression ?? 'unknown',
        pose: summary?.pose ?? 'unknown',
        action: summary?.action ?? [],
        facing: summary?.facing ?? 'unknown',
        occlusion: summary?.occlusion ?? 0,
        clothing: summary?.clothing ?? [],
        bbox: observation.bbox,
        depth: summary?.depth ?? null,
        keypoints: summary?.keypoints ?? [],
        _className: observation.className,
        _detectionConfidence: observation.confidence,
      } as PersonAnnotation)
    } else {
      const summary = objectsById.get(observation.trackId)
      objects.push({
        trackId: observation.trackId,
        // A reviewed frame label is more specific than the segment summary.
        // This lets one misclassified frame be corrected without relabelling
        // every observation carried by the same tracker identity.
        name: observation.className || summary?.name || 'object',
        category: summary?.category || 'other',
        color: summary?.color || 'unknown',
        brand: summary?.brand ?? null,
        bbox: observation.bbox,
        depth: summary?.depth ?? null,
        _detectionConfidence: observation.confidence,
        ...(summary?._textContent ? { _textContent: summary._textContent } : {}),
      })
    }
  }
  return { persons, objects }
}

export function replaceObservation(
  frame: FrameAnnotation,
  ref: TrackRef,
  update: (observation: FrameObservation) => FrameObservation | null,
): FrameAnnotation {
  return {
    ...frame,
    observations: frame.observations.flatMap(observation => {
      if (observation.trackId !== ref.trackId || observation.entityType !== ref.entityType) return [observation]
      const next = update(observation)
      return next ? [next] : []
    }),
  }
}

export function upsertFrame(annotation: SegmentAnnotation, frame: FrameAnnotation): SegmentAnnotation {
  const frames = [...(annotation.frames || [])]
  const index = frames.findIndex(item => item.frameIndex === frame.frameIndex)
  if (index >= 0) frames[index] = frame
  else frames.push(frame)
  frames.sort((left, right) => left.timestamp - right.timestamp || left.frameIndex - right.frameIndex)
  return { ...annotation, frames, _humanEdited: true }
}

export function nextTrackId(annotation: SegmentAnnotation): number {
  const ids = [
    ...(annotation.persons || []).map(item => item.trackId),
    ...(annotation.objects || []).map(item => item.trackId),
    ...(annotation.frames || []).flatMap(frame => frame.observations.map(item => item.trackId)),
  ]
  return Math.max(0, ...ids) + 1
}

/**
 * Merge a server-returned segment annotation into a local optimistic one.
 * Local pending edits (per-track person/object summaries and frame
 * observations) win; server-side additions that the local copy does not know
 * about (e.g. a freshly allocated manual track) are adopted. This prevents a
 * stale server snapshot from clobbering edits made while the request was
 * in flight.
 */
export function mergeSegmentAnnotationFromServer(
  local: SegmentAnnotation,
  server: SegmentAnnotation,
): SegmentAnnotation {
  const localPersons = new Map(local.persons.map(item => [item.trackId, item] as const))
  const serverPersons = new Map(server.persons.map(item => [item.trackId, item] as const))
  // Local pending edits win; server-only tracks (freshly drawn) are adopted.
  const personsById = new Map(serverPersons)
  for (const [trackId, item] of localPersons) {
    personsById.set(trackId, item)
  }

  const localObjects = new Map(local.objects.map(item => [item.trackId, item] as const))
  const serverObjects = new Map(server.objects.map(item => [item.trackId, item] as const))
  const objectsById = new Map(serverObjects)
  for (const [trackId, item] of localObjects) {
    objectsById.set(trackId, item)
  }

  // Merge frame observations: local observations win per track; server-only
  // observations (e.g. the new track) are appended.
  const localFrames = new Map((local.frames || []).map(frame => [frame.frameIndex, frame] as const))
  const serverFrames = new Map((server.frames || []).map(frame => [frame.frameIndex, frame] as const))
  const frames: FrameAnnotation[] = []
  for (const [frameIndex, serverFrame] of serverFrames) {
    const localFrame = localFrames.get(frameIndex)
    if (!localFrame) {
      frames.push(serverFrame)
      continue
    }
    const localObs = new Map(localFrame.observations.map(o => [o.trackId, o] as const))
    const mergedObs = new Map(serverFrame.observations.map(o => [o.trackId, o] as const))
    for (const [trackId, observation] of localObs) {
      mergedObs.set(trackId, observation)
    }
    frames.push({
      ...serverFrame,
      observations: [...mergedObs.values()].sort((a, b) => a.trackId - b.trackId),
    })
  }
  // Frames that exist only locally are kept as-is.
  for (const [frameIndex, localFrame] of localFrames) {
    if (!serverFrames.has(frameIndex)) frames.push(localFrame)
  }
  frames.sort((left, right) => left.timestamp - right.timestamp || left.frameIndex - right.frameIndex)

  return {
    ...local,
    persons: [...personsById.values()],
    objects: [...objectsById.values()],
    frames,
    _humanEdited: true,
  }
}

export type ObjectLabelRenameScope = 'frame' | 'track' | 'matching_segment'

function objectLabelKey(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toLowerCase()
}

function isOcrSummary(object: ObjectAnnotation): boolean {
  return '_textContent' in object || objectLabelKey(object.category) === 'text'
}

function isGeneratedVisualEvent(event: SegmentAnnotation['events'][number]): boolean {
  return (
    event.type === 'visual_activity'
    && event.confidence === 0.6
    && /^The (?:frame|segment) shows\b/.test(event.description || '')
  )
}

/**
 * Keep a manually reviewed object label consistent between the segment
 * summary and every sampled-frame observation. The optional matching scope is
 * explicit because one physical object may have fragmented detector tracks.
 */
export function renameObjectLabel(
  annotation: SegmentAnnotation,
  selectedTrackId: number,
  previousNames: string | string[],
  nextName: string,
  scope: ObjectLabelRenameScope,
  frameIndex?: number,
): SegmentAnnotation {
  const normalizedNextName = nextName.trim()
  if (!normalizedNextName) return annotation

  if (scope === 'frame') {
    if (!Number.isInteger(frameIndex)) return annotation
    let changed = false
    const frames = (annotation.frames || []).map(frame => {
      if (frame.frameIndex !== frameIndex) return frame
      return {
        ...frame,
        observations: frame.observations.map(observation => {
          if (observation.entityType !== 'object' || observation.trackId !== selectedTrackId) {
            return observation
          }
          changed = true
          return {
            ...observation,
            className: normalizedNextName,
            source: 'manual' as const,
          }
        }),
      }
    })
    return changed ? { ...annotation, frames, _humanEdited: true } : annotation
  }

  const previousKeys = new Set(
    (Array.isArray(previousNames) ? previousNames : [previousNames])
      .map(objectLabelKey)
      .filter(Boolean),
  )
  const summaryByTrackId = new Map(
    (annotation.objects || []).map(object => [object.trackId, object]),
  )
  const targetTrackIds = new Set<number>([selectedTrackId])

  if (scope === 'matching_segment' && previousKeys.size > 0) {
    for (const object of annotation.objects || []) {
      if (!isOcrSummary(object) && previousKeys.has(objectLabelKey(object.name))) {
        targetTrackIds.add(object.trackId)
      }
    }
    for (const frame of annotation.frames || []) {
      for (const observation of frame.observations || []) {
        const summary = summaryByTrackId.get(observation.trackId)
        if (
          observation.entityType === 'object'
          && !summary?.['_textContent']
          && objectLabelKey(summary?.category || '') !== 'text'
          && previousKeys.has(objectLabelKey(observation.className))
        ) {
          targetTrackIds.add(observation.trackId)
        }
      }
    }
  }

  const editableTrackIds = new Set(
    [...targetTrackIds].filter(trackId => {
      const summary = summaryByTrackId.get(trackId)
      return !summary || !isOcrSummary(summary)
    }),
  )
  const objects = (annotation.objects || []).map(object => (
    editableTrackIds.has(object.trackId) && !isOcrSummary(object)
      ? { ...object, name: normalizedNextName }
      : object
  ))
  const frames = (annotation.frames || []).map(frame => ({
    ...frame,
    observations: frame.observations.map(observation => (
      observation.entityType === 'object' && editableTrackIds.has(observation.trackId)
        ? {
            ...observation,
            className: normalizedNextName,
            source: 'manual' as const,
          }
        : observation
    )),
  }))

  const existingEvents = annotation.events || []
  const preservedEvents = existingEvents.filter(event => !isGeneratedVisualEvent(event))
  let events = existingEvents
  if (existingEvents.length === 0 || preservedEvents.length !== existingEvents.length) {
    const visibleObjects = objects.filter(object => !isOcrSummary(object))
    const refreshed = deriveGroundedVisualEvent(
      annotation.persons || [],
      visibleObjects,
      { context: 'segment', exactCounts: false },
    )
    events = refreshed ? [...preservedEvents, refreshed] : preservedEvents
  }

  return {
    ...annotation,
    objects,
    frames,
    events,
    _humanEdited: true,
  }
}

export type EntityConversionScope = 'frame' | 'track'

/** Convert one frame observation or every matching observation in a segment. */
export function convertEntityType(
  annotation: SegmentAnnotation,
  ref: TrackRef,
  targetType: SpatialEntityType,
  scope: EntityConversionScope,
  frameIndex: number | null,
  objectLabel?: string,
): SegmentAnnotation {
  if (ref.entityType === targetType) return annotation
  const normalizedLabel = objectLabel?.trim() || ''
  if (targetType === 'object' && !normalizedLabel) {
    throw new Error('An object label is required')
  }

  let convertedBox: BBox | null = null
  let convertedCount = 0
  const frames = (annotation.frames || []).map(frame => {
    if (scope === 'frame' && frame.frameIndex !== frameIndex) return frame
    return {
      ...frame,
      observations: frame.observations.map(observation => {
        if (observation.trackId !== ref.trackId || observation.entityType !== ref.entityType) return observation
        convertedBox ||= observation.bbox
        convertedCount++
        return {
          ...observation,
          entityType: targetType,
          className: targetType === 'person' ? 'person' : normalizedLabel,
          source: 'manual' as const,
        }
      }),
    }
  })
  if (convertedCount === 0) return annotation

  const sourcePerson = annotation.persons.find(item => item.trackId === ref.trackId)
  const sourceObject = annotation.objects.find(item => item.trackId === ref.trackId)
  const fallbackBox = convertedBox || sourcePerson?.bbox || sourceObject?.bbox
  if (!fallbackBox) return annotation

  const sourceStillObserved = frames.some(frame => frame.observations.some(observation => (
    observation.trackId === ref.trackId && observation.entityType === ref.entityType
  )))
  let persons = [...annotation.persons]
  let objects = [...annotation.objects]

  if (targetType === 'person') {
    if (!persons.some(item => item.trackId === ref.trackId)) {
      persons.push({
        trackId: ref.trackId,
        personId: sourceObject?._convertedPersonId ?? null,
        gender: 'unknown',
        ageGroup: 'unknown',
        hair: { color: 'unknown', style: 'unknown' },
        expression: 'unknown',
        pose: 'unknown',
        action: [],
        facing: 'unknown',
        occlusion: 0,
        clothing: [],
        bbox: fallbackBox,
        depth: sourceObject?.depth ?? null,
        keypoints: [],
        _className: 'manual',
      })
    }
    if (!sourceStillObserved) objects = objects.filter(item => item.trackId !== ref.trackId)
  } else {
    const existingIndex = objects.findIndex(item => item.trackId === ref.trackId)
    const convertedObject: ObjectAnnotation = {
      trackId: ref.trackId,
      name: normalizedLabel,
      category: existingIndex >= 0 ? objects[existingIndex].category : 'other',
      color: existingIndex >= 0 ? objects[existingIndex].color : 'unknown',
      brand: existingIndex >= 0 ? objects[existingIndex].brand : null,
      bbox: fallbackBox,
      depth: sourcePerson?.depth ?? (existingIndex >= 0 ? objects[existingIndex].depth : null),
      _convertedPersonId: sourcePerson?.personId || (existingIndex >= 0 ? objects[existingIndex]._convertedPersonId : undefined),
    }
    if (existingIndex >= 0) objects[existingIndex] = { ...objects[existingIndex], ...convertedObject }
    else objects.push(convertedObject)
    if (!sourceStillObserved) persons = persons.filter(item => item.trackId !== ref.trackId)
  }

  return { ...annotation, frames, persons, objects, _humanEdited: true }
}
