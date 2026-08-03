import type {
  BBox,
  FrameAnnotation,
  FrameObservation,
  ObjectAnnotation,
  SegmentAnnotation,
} from './types'

const OCR_TRACK_ID_BASE = 1_000_000
const LEGACY_RELINK_MAX_GAP_SECONDS = 1
const LEGACY_RELINK_MIN_IOU = 0.55
const LEGACY_RELINK_MIN_MARGIN = 0.1

export interface AnnotationMigrationResult {
  annotation: SegmentAnnotation
  changed: boolean
}

function labelKey(value: string | undefined): string {
  return (value || '').normalize('NFKC').trim().toLowerCase()
}

function isTextObject(object: ObjectAnnotation): boolean {
  return Boolean(object._textContent) || labelKey(object.category) === 'text'
}

function isHybridLegacyObject(object: ObjectAnnotation): boolean {
  const text = labelKey(object._textContent)
  if (!text || labelKey(object.category) === 'text') return false
  return labelKey(object.name) !== text
}

function bboxIou(left: BBox, right: BBox): number {
  const x1 = Math.max(left.x, right.x)
  const y1 = Math.max(left.y, right.y)
  const x2 = Math.min(left.x + left.width, right.x + right.width)
  const y2 = Math.min(left.y + left.height, right.y + right.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

interface TimedObservation {
  frameIndex: number
  timestamp: number
  observation: FrameObservation
}

function observationsFor(
  frames: FrameAnnotation[],
  trackId: number,
): TimedObservation[] {
  return frames.flatMap(frame => frame.observations.flatMap(observation => (
    observation.entityType === 'object' && observation.trackId === trackId
      ? [{ frameIndex: frame.frameIndex, timestamp: frame.timestamp, observation }]
      : []
  )))
}

function compatibleCategory(left: ObjectAnnotation, right: ObjectAnnotation): boolean {
  const leftCategory = labelKey(left.category)
  const rightCategory = labelKey(right.category)
  return (
    !leftCategory
    || leftCategory === 'other'
    || !rightCategory
    || rightCategory === 'other'
    || leftCategory === rightCategory
  )
}

/**
 * Recover the ordinary-object side of an old OCR/track collision only when a
 * neighbouring track is provably compatible: same category, no co-occurrence,
 * at most one second apart, and strong boundary-box overlap.
 */
function findSafeOrdinaryTrack(
  hybrid: ObjectAnnotation,
  objects: ObjectAnnotation[],
  frames: FrameAnnotation[],
): number | null {
  const source = observationsFor(frames, hybrid.trackId)
  if (source.length === 0) return null

  const candidates: Array<{ trackId: number; score: number }> = []
  const sourceFrames = new Set(source.map(item => item.frameIndex))
  for (const object of objects) {
    if (
      object.trackId === hybrid.trackId
      || isTextObject(object)
      || !compatibleCategory(hybrid, object)
    ) {
      continue
    }
    const target = observationsFor(frames, object.trackId)
    if (
      target.length === 0
      || target.some(item => sourceFrames.has(item.frameIndex))
    ) {
      continue
    }

    const sourceFirst = source[0]
    const sourceLast = source[source.length - 1]
    const targetFirst = target[0]
    const targetLast = target[target.length - 1]
    let gap = Number.POSITIVE_INFINITY
    let overlap = 0
    if (sourceLast.timestamp < targetFirst.timestamp) {
      gap = targetFirst.timestamp - sourceLast.timestamp
      overlap = bboxIou(sourceLast.observation.bbox, targetFirst.observation.bbox)
    } else if (targetLast.timestamp < sourceFirst.timestamp) {
      gap = sourceFirst.timestamp - targetLast.timestamp
      overlap = bboxIou(targetLast.observation.bbox, sourceFirst.observation.bbox)
    }
    if (gap <= LEGACY_RELINK_MAX_GAP_SECONDS && overlap >= LEGACY_RELINK_MIN_IOU) {
      candidates.push({ trackId: object.trackId, score: overlap })
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.trackId - right.trackId)
  if (candidates.length === 0) return null
  if (
    candidates.length > 1
    && candidates[0].score - candidates[1].score < LEGACY_RELINK_MIN_MARGIN
  ) {
    return null
  }
  return candidates[0].trackId
}

function nextOcrTrackId(objects: ObjectAnnotation[], frames: FrameAnnotation[]): number {
  const used = [
    ...objects.map(object => object.trackId),
    ...frames.flatMap(frame => frame.observations.map(observation => observation.trackId)),
  ]
  return Math.max(OCR_TRACK_ID_BASE - 1, ...used) + 1
}

function copyMissingModelOcr(
  objects: ObjectAnnotation[],
  frames: FrameAnnotation[],
  modelAnnotation: SegmentAnnotation | null | undefined,
): { objects: ObjectAnnotation[]; frames: FrameAnnotation[] } {
  const donors = (modelAnnotation?.objects || []).filter(isTextObject)
  if (donors.length === 0) return { objects, frames }

  const copiedObjects = [...objects]
  const copiedFrames = frames.map(frame => ({
    ...frame,
    observations: [...frame.observations],
  }))
  const existingTexts = new Set(
    copiedObjects.filter(isTextObject).map(object => labelKey(object._textContent || object.name)),
  )
  let nextTrackId = nextOcrTrackId(copiedObjects, copiedFrames)

  for (const donor of donors) {
    const textKey = labelKey(donor._textContent || donor.name)
    if (!textKey || existingTexts.has(textKey)) continue
    const usedIds = new Set([
      ...copiedObjects.map(object => object.trackId),
      ...copiedFrames.flatMap(frame => frame.observations.map(observation => observation.trackId)),
    ])
    const targetTrackId = donor.trackId >= OCR_TRACK_ID_BASE && !usedIds.has(donor.trackId)
      ? donor.trackId
      : nextTrackId
    // Always advance past the allocated id so a later donor can never reuse it,
    // even when the current donor reused its own id (no counter bump above).
    nextTrackId = Math.max(nextTrackId, targetTrackId + 1)
    copiedObjects.push({
      ...donor,
      trackId: targetTrackId,
      category: 'text',
      bbox: donor.bbox ? { ...donor.bbox } : null,
    })

    for (const modelFrame of modelAnnotation?.frames || []) {
      const donorObservations = modelFrame.observations.filter(observation => (
        observation.entityType === 'object' && observation.trackId === donor.trackId
      ))
      if (donorObservations.length === 0) continue
      const targetFrame = copiedFrames.find(frame => frame.frameIndex === modelFrame.frameIndex)
      if (!targetFrame) continue
      for (const observation of donorObservations) {
        targetFrame.observations.push({
          ...observation,
          trackId: targetTrackId,
          className: donor._textContent || donor.name,
          bbox: { ...observation.bbox },
        })
      }
    }
    existingTexts.add(textKey)
  }
  return { objects: copiedObjects, frames: copiedFrames }
}

/**
 * Split legacy records where one low Track ID was simultaneously used as an
 * ordinary object and OCR text. The migration is idempotent and deliberately
 * refuses ambiguous object relinking.
 */
export function repairLegacyOcrObjectCollisions(
  annotation: SegmentAnnotation,
  modelAnnotation?: SegmentAnnotation | null,
): AnnotationMigrationResult {
  const hybrids = (annotation.objects || []).filter(isHybridLegacyObject)
  if (hybrids.length === 0) return { annotation, changed: false }

  let objects = (annotation.objects || []).map(object => ({
    ...object,
    bbox: object.bbox ? { ...object.bbox } : null,
  }))
  let frames = (annotation.frames || []).map(frame => ({
    ...frame,
    observations: frame.observations.map(observation => ({
      ...observation,
      bbox: { ...observation.bbox },
    })),
  }))

  for (const hybrid of hybrids) {
    const targetTrackId = findSafeOrdinaryTrack(hybrid, objects, frames)
    if (targetTrackId != null) {
      frames = frames.map(frame => ({
        ...frame,
        observations: frame.observations.map(observation => (
          observation.entityType === 'object' && observation.trackId === hybrid.trackId
            ? { ...observation, trackId: targetTrackId }
            : observation
        )),
      }))
      objects = objects.filter(object => object.trackId !== hybrid.trackId)
    } else {
      objects = objects.map(object => {
        if (object.trackId !== hybrid.trackId) return object
        const ordinary = { ...object }
        delete ordinary._textContent
        return ordinary
      })
    }
  }

  const restoredOcr = copyMissingModelOcr(objects, frames, modelAnnotation)
  return {
    annotation: {
      ...annotation,
      objects: restoredOcr.objects,
      frames: restoredOcr.frames,
    },
    changed: true,
  }
}
