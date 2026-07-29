import type { SegmentAnnotation } from './types'
import { visualEventsFor } from './visual-events'
import { findAnnotationTrackConflicts } from './manual-track'

export type SegmentReviewMetadata = Pick<SegmentAnnotation, 'segmentId' | 'start' | 'end'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateBbox(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  for (const field of ['x', 'y', 'width', 'height']) {
    if (!isFiniteNumber(value[field])) errors.push(`${path}.${field} must be a finite number`)
  }
}

/** Keep review identity/range anchored to the selected outer segment. */
export function withAuthoritativeSegmentMetadata(
  annotation: SegmentAnnotation,
  metadata: SegmentReviewMetadata,
): SegmentAnnotation {
  return {
    ...annotation,
    segmentId: metadata.segmentId,
    start: metadata.start,
    end: metadata.end,
  }
}

/**
 * Produce the same editable payload that the historical raw JSON editor showed,
 * while hiding runtime-only diagnostics that must not be written by reviewers.
 */
export function prepareSegmentAnnotationForReview(
  annotation: SegmentAnnotation,
  metadata?: SegmentReviewMetadata,
): SegmentAnnotation {
  const authoritative = metadata
    ? withAuthoritativeSegmentMetadata(annotation, metadata)
    : annotation
  const topClean = { ...authoritative } as unknown as Record<string, unknown>
  delete topClean._pipeline_errors
  delete topClean._recognition
  delete topClean._provider_statuses
  delete topClean._pipeline_status
  delete topClean._identity_aliases
  delete topClean._humanEdited

  const legacySpeech = (authoritative.events || [])
    .filter(event => event.type.startsWith('[Speech]'))
    .map(event => event.type.replace(/^\[Speech\]\s*/, '').trim())
    .filter(Boolean)
    .join('\n')

  return {
    ...topClean,
    speechTranscript: authoritative.speechTranscript || legacySpeech || undefined,
    persons: (authoritative.persons || []).map(person => {
      const cleaned = { ...person } as unknown as Record<string, unknown>
      delete cleaned._className
      delete cleaned._detectionConfidence
      return cleaned as unknown as typeof person
    }),
    objects: (authoritative.objects || []).map(object => {
      const cleaned = { ...object } as unknown as Record<string, unknown>
      delete cleaned._detectionConfidence
      return cleaned as unknown as typeof object
    }),
    events: visualEventsFor(authoritative),
  } as SegmentAnnotation
}

/** Validate the editable annotation boundary before replacing human data. */
export function validateSegmentAnnotationReview(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) return ['Root value must be a JSON object']

  for (const field of ['segmentId', 'start', 'end']) {
    if (!isFiniteNumber(value[field])) errors.push(`${field} must be a finite number`)
  }
  if (isFiniteNumber(value.start) && isFiniteNumber(value.end) && value.end <= value.start) {
    errors.push('end must be greater than start')
  }

  if (!isRecord(value.scene)) {
    errors.push('scene must be an object')
  } else {
    if (!Array.isArray(value.scene.tags)) errors.push('scene.tags must be an array')
    if (!isRecord(value.scene.place)) errors.push('scene.place must be an object')
  }
  if (!isRecord(value.camera)) errors.push('camera must be an object')

  for (const field of ['persons', 'objects', 'events']) {
    if (!Array.isArray(value[field])) errors.push(`${field} must be an array`)
  }

  if (Array.isArray(value.persons)) {
    value.persons.forEach((person, index) => {
      const path = `persons[${index}]`
      if (!isRecord(person)) {
        errors.push(`${path} must be an object`)
        return
      }
      if (!isFiniteNumber(person.trackId)) errors.push(`${path}.trackId must be a finite number`)
      validateBbox(person.bbox, `${path}.bbox`, errors)
    })
  }

  if (Array.isArray(value.objects)) {
    value.objects.forEach((object, index) => {
      const path = `objects[${index}]`
      if (!isRecord(object)) {
        errors.push(`${path} must be an object`)
        return
      }
      if (!isFiniteNumber(object.trackId)) errors.push(`${path}.trackId must be a finite number`)
      if (object.bbox !== null) validateBbox(object.bbox, `${path}.bbox`, errors)
    })
  }

  if (Array.isArray(value.events)) {
    value.events.forEach((event, index) => {
      const path = `events[${index}]`
      if (!isRecord(event)) {
        errors.push(`${path} must be an object`)
        return
      }
      if (typeof event.type !== 'string') errors.push(`${path}.type must be a string`)
      if (!isFiniteNumber(event.confidence)) errors.push(`${path}.confidence must be a finite number`)
    })
  }

  if (value.frames !== undefined) {
    if (!Array.isArray(value.frames)) {
      errors.push('frames must be an array when present')
    } else {
      value.frames.forEach((frame, index) => {
        const path = `frames[${index}]`
        if (!isRecord(frame)) {
          errors.push(`${path} must be an object`)
          return
        }
        if (!isFiniteNumber(frame.frameIndex)) errors.push(`${path}.frameIndex must be a finite number`)
        if (!isFiniteNumber(frame.timestamp)) errors.push(`${path}.timestamp must be a finite number`)
        if (!Array.isArray(frame.observations)) errors.push(`${path}.observations must be an array`)
      })
    }
  }

  if (value.speechTranscript !== undefined && typeof value.speechTranscript !== 'string') {
    errors.push('speechTranscript must be a string when present')
  }

  if (errors.length === 0) {
    errors.push(...findAnnotationTrackConflicts(value as unknown as SegmentAnnotation))
  }

  return errors
}
