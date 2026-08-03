import type {
  AnnotateSet,
  BBox,
  FrameAnnotation,
  SegmentAnnotation,
  SegmentState,
  SpatialEntityType,
  VideoTaskItem,
} from './types'

export interface AddManualTrackInput {
  videoId: string
  segmentId: number
  frameIndex: number
  timestamp: number
  imageWidth: number
  imageHeight: number
  entityType: SpatialEntityType
  className: string
  bbox: BBox
}

export interface AddManualTrackResult {
  task: AnnotateSet
  trackId: number
  personId: string | null
}

export class ManualTrackError extends Error {
  constructor(
    public readonly code: 'VIDEO_NOT_FOUND' | 'SEGMENT_NOT_FOUND' | 'ANNOTATION_NOT_FOUND' | 'INVALID_INPUT',
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ManualTrackError'
  }
}

function hasReviewData(human: SegmentAnnotation | null, model: SegmentAnnotation | null): boolean {
  if (!human) return false
  if (human._humanEdited) return true
  return (
    human.scene?.place?.type !== 'unknown'
    || (human.persons || []).some(person => person.gender !== 'unknown' || (person.clothing || []).length > 0)
    || human.camera?.angle !== 'unknown'
    || (human.events || []).length > 0
    || Boolean(human.speechTranscript)
    || (human.objects || []).some(object => Boolean(object.name && object.name !== 'unknown'))
    || (human.persons || []).length > (model?.persons?.length || 0)
    || (human.objects || []).length > (model?.objects?.length || 0)
  )
}

function effectiveAnnotation(segment: SegmentState): SegmentAnnotation | null {
  return hasReviewData(segment.humanAnnotation, segment.modelAnnotation)
    ? segment.humanAnnotation
    : segment.modelAnnotation || null
}

function cloneAnnotation(annotation: SegmentAnnotation): SegmentAnnotation {
  return JSON.parse(JSON.stringify(annotation)) as SegmentAnnotation
}

function usedTrackIds(annotation: SegmentAnnotation): Set<number> {
  return new Set([
    ...(annotation.persons || []).map(item => item.trackId),
    ...(annotation.objects || []).map(item => item.trackId),
    ...(annotation.frames || []).flatMap(frame => frame.observations.map(item => item.trackId)),
  ].filter(value => Number.isSafeInteger(value) && value >= 0))
}

function nextTrackId(segment: SegmentState, annotation: SegmentAnnotation): number {
  const used = usedTrackIds(annotation)
  const largestExisting = Math.max(0, ...used)
  let candidate = Math.max(1, segment.nextManualTrackId || 1, largestExisting + 1)
  while (used.has(candidate)) candidate += 1
  if (!Number.isSafeInteger(candidate)) {
    throw new ManualTrackError('INVALID_INPUT', 409, 'No safe manual Track ID is available')
  }
  return candidate
}

function manualPersonSequence(video: VideoTaskItem): number {
  const prefix = `${video.videoId}:manual-person:`
  let next = Math.max(1, video.nextManualPersonId || 1)
  for (const segment of video.segments || []) {
    for (const annotation of [segment.modelAnnotation, segment.humanAnnotation]) {
      for (const person of annotation?.persons || []) {
        if (!person.personId?.startsWith(prefix)) continue
        const suffix = Number(person.personId.slice(prefix.length))
        if (Number.isSafeInteger(suffix) && suffix >= next) next = suffix + 1
      }
    }
  }
  return next
}

function normalizedBox(box: BBox, imageWidth: number, imageHeight: number): BBox {
  if (
    ![box.x, box.y, box.width, box.height, imageWidth, imageHeight].every(Number.isFinite)
    || imageWidth <= 0
    || imageHeight <= 0
    || box.width <= 0
    || box.height <= 0
  ) {
    throw new ManualTrackError('INVALID_INPUT', 400, 'Manual bounding box and image dimensions must be positive finite numbers')
  }
  const x = Math.max(0, Math.min(imageWidth, box.x))
  const y = Math.max(0, Math.min(imageHeight, box.y))
  const width = Math.min(Math.max(0, box.width), imageWidth - x)
  const height = Math.min(Math.max(0, box.height), imageHeight - y)
  if (width <= 0 || height <= 0) {
    throw new ManualTrackError('INVALID_INPUT', 400, 'Manual bounding box must overlap the image')
  }
  const rounded = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
  if (rounded.width <= 0 || rounded.height <= 0) {
    throw new ManualTrackError('INVALID_INPUT', 400, 'Manual bounding box is too small')
  }
  return rounded
}

function upsertManualFrame(
  annotation: SegmentAnnotation,
  input: AddManualTrackInput,
  trackId: number,
  bbox: BBox,
): FrameAnnotation[] {
  const frames = [...(annotation.frames || [])]
  const frameIndex = frames.findIndex(frame => frame.frameIndex === input.frameIndex)
  const source = frameIndex >= 0
    ? frames[frameIndex]
    : {
        frameIndex: input.frameIndex,
        timestamp: input.timestamp,
        imageWidth: input.imageWidth,
        imageHeight: input.imageHeight,
        observations: [],
      }
  const frame = {
    ...source,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    // Idempotent upsert: a retried request for the same track must not append
    // a duplicate observation to the same frame.
    observations: [
      ...source.observations.filter(observation => observation.trackId !== trackId),
      {
        trackId,
        entityType: input.entityType,
        className: input.className,
        bbox,
        source: 'manual' as const,
      },
    ],
  }
  if (frameIndex >= 0) frames[frameIndex] = frame
  else frames.push(frame)
  frames.sort((left, right) => left.timestamp - right.timestamp || left.frameIndex - right.frameIndex)
  return frames
}

/**
 * Add one manual box using task state as the source of truth. Callers must
 * invoke this while holding the task-file lock.
 */
export function addManualTrack(task: AnnotateSet, input: AddManualTrackInput): AddManualTrackResult {
  if (
    !input.videoId
    || !Number.isInteger(input.segmentId)
    || !Number.isInteger(input.frameIndex)
    || input.frameIndex < 0
    || !Number.isFinite(input.timestamp)
    || input.timestamp < 0
    || !['person', 'object'].includes(input.entityType)
  ) {
    throw new ManualTrackError('INVALID_INPUT', 400, 'Invalid manual Track request')
  }
  const className = input.entityType === 'person' ? 'person' : input.className.trim()
  if (!className) {
    throw new ManualTrackError('INVALID_INPUT', 400, 'A manual object requires a non-empty label')
  }

  const videoIndex = (task.videos || []).findIndex(video => video.videoId === input.videoId)
  if (videoIndex < 0) throw new ManualTrackError('VIDEO_NOT_FOUND', 404, 'Video not found in this project')
  const video = task.videos[videoIndex]
  const segmentIndex = (video.segments || []).findIndex(segment => segment.segmentId === input.segmentId)
  if (segmentIndex < 0) throw new ManualTrackError('SEGMENT_NOT_FOUND', 404, 'Segment not found in this video')
  const segment = video.segments[segmentIndex]
  const source = effectiveAnnotation(segment)
  if (!source) throw new ManualTrackError('ANNOTATION_NOT_FOUND', 409, 'Annotate the segment before drawing a manual Track')

  const annotation = cloneAnnotation(source)
  const trackId = nextTrackId(segment, annotation)
  const bbox = normalizedBox(input.bbox, input.imageWidth, input.imageHeight)
  let personId: string | null = null
  let nextManualPersonId = video.nextManualPersonId

  annotation.frames = upsertManualFrame(annotation, { ...input, className }, trackId, bbox)
  annotation._humanEdited = true
  if (input.entityType === 'person') {
    const sequence = manualPersonSequence(video)
    personId = `${video.videoId}:manual-person:${sequence}`
    nextManualPersonId = sequence + 1
    annotation.persons = [...(annotation.persons || []), {
      trackId,
      personId,
      gender: 'unknown',
      ageGroup: 'unknown',
      hair: { color: 'unknown', style: 'unknown' },
      expression: 'unknown',
      pose: 'unknown',
      action: [],
      facing: 'unknown',
      occlusion: 0,
      clothing: [],
      bbox,
      depth: null,
      keypoints: [],
      _className: 'manual',
    }]
  } else {
    annotation.objects = [...(annotation.objects || []), {
      trackId,
      name: className,
      category: 'other',
      color: 'unknown',
      brand: null,
      bbox,
      depth: null,
    }]
  }

  const nextSegment: SegmentState = {
    ...segment,
    humanAnnotation: annotation,
    nextManualTrackId: trackId + 1,
  }
  const nextVideo: VideoTaskItem = {
    ...video,
    ...(nextManualPersonId === undefined ? {} : { nextManualPersonId }),
    segments: video.segments.map((item, index) => index === segmentIndex ? nextSegment : item),
  }
  return {
    task: {
      ...task,
      videos: task.videos.map((item, index) => index === videoIndex ? nextVideo : item),
    },
    trackId,
    personId,
  }
}

/** Return duplicate summary/frame keys that would make editing ambiguous. */
export function findAnnotationTrackConflicts(annotation: SegmentAnnotation): string[] {
  const conflicts: string[] = []
  const duplicateIndexes = (
    values: Array<{ trackId: number }>,
    path: string,
    entityType: SpatialEntityType,
  ) => {
    const seen = new Set<number>()
    values.forEach((value, index) => {
      if (seen.has(value.trackId)) conflicts.push(`${path}[${index}] duplicates ${entityType} Track ${value.trackId}`)
      seen.add(value.trackId)
    })
  }
  duplicateIndexes(annotation.persons || [], 'persons', 'person')
  duplicateIndexes(annotation.objects || [], 'objects', 'object')
  for (const frame of annotation.frames || []) {
    const seen = new Set<string>()
    frame.observations.forEach((observation, index) => {
      const key = `${observation.entityType}:${observation.trackId}`
      if (seen.has(key)) {
        conflicts.push(`frames[${frame.frameIndex}].observations[${index}] duplicates ${key}`)
      }
      seen.add(key)
    })
  }
  return conflicts
}

/**
 * Backfill only missing identities on explicitly manual person summaries.
 * Each historical summary receives a distinct identity; no cross-segment
 * person merge is inferred.
 */
export function assignMissingManualPersonIds(task: AnnotateSet): boolean {
  let changed = false
  for (const video of task.videos || []) {
    let videoChanged = false
    let sequence = manualPersonSequence(video)
    for (const segment of video.segments || []) {
      const annotation = segment.humanAnnotation
      if (!annotation) continue
      for (const person of annotation.persons || []) {
        if (person.personId || person._className !== 'manual') continue
        person.personId = `${video.videoId}:manual-person:${sequence}`
        sequence += 1
        videoChanged = true
        changed = true
      }
    }
    if (videoChanged && video.nextManualPersonId !== sequence) {
      video.nextManualPersonId = sequence
    }
  }
  return changed
}
