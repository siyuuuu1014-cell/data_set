import type { AnnotateSet, SegmentAnnotation, VideoIdentityReview, VideoTaskItem } from './types'

export class IdentityReviewError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) { super(message); this.name = 'IdentityReviewError' }
}

function state(video: VideoTaskItem): VideoIdentityReview {
  video.identityReview ||= { aliases: {}, segmentOverrides: {}, lockedPersonIds: [] }
  return video.identityReview
}

function resolve(review: VideoIdentityReview, personId: string): string {
  let current = personId
  const visited = new Set<string>()
  while (review.aliases[current] && !visited.has(current)) { visited.add(current); current = review.aliases[current] }
  return current
}

export function applyManualIdentityReview(video: VideoTaskItem): boolean {
  if (!video.identityReview) return false
  let changed = false
  const review = video.identityReview
  for (const segment of video.segments || []) {
    for (const annotation of [segment.modelAnnotation, segment.humanAnnotation]) {
      if (!annotation) continue
      for (const person of annotation.persons || []) {
        const override = review.segmentOverrides[`${segment.segmentId}:${person.trackId}`]
        const next = override || (person.personId ? resolve(review, person.personId) : null)
        if (next && next !== person.personId) { person.personId = next; changed = true }
      }
    }
  }
  return changed
}

export function mergeVideoPeople(task: AnnotateSet, videoId: string, sourceId: string, targetId: string): AnnotateSet {
  const video = task.videos.find(item => item.videoId === videoId)
  if (!video) throw new IdentityReviewError('VIDEO_NOT_FOUND', 404, 'Video not found')
  if (!sourceId || !targetId || sourceId === targetId) throw new IdentityReviewError('INVALID_IDENTITY', 400, 'Choose two different identities')
  const review = state(video)
  review.aliases[sourceId] = resolve(review, targetId)
  review.lockedPersonIds = [...new Set([...review.lockedPersonIds.filter(id => id !== sourceId), resolve(review, targetId)])]
  applyManualIdentityReview(video)
  task.updatedAt = new Date().toISOString()
  return task
}

function nextManualPersonSequence(video: VideoTaskItem): number {
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

export function splitVideoPerson(task: AnnotateSet, videoId: string, segmentId: number, trackId: number): { task: AnnotateSet; personId: string } {
  const video = task.videos.find(item => item.videoId === videoId)
  if (!video) throw new IdentityReviewError('VIDEO_NOT_FOUND', 404, 'Video not found')
  const segment = video.segments.find(item => item.segmentId === segmentId)
  if (!segment) throw new IdentityReviewError('SEGMENT_NOT_FOUND', 404, 'Segment not found')
  const exists = [segment.humanAnnotation, segment.modelAnnotation].some(annotation => annotation?.persons.some(person => person.trackId === trackId))
  if (!exists) throw new IdentityReviewError('PERSON_NOT_FOUND', 404, 'Person track not found in this segment')
  // Scan existing person IDs so a stale counter can never allocate a duplicate
  const sequence = nextManualPersonSequence(video)
  const personId = `${video.videoId}:manual-person:${sequence}`
  video.nextManualPersonId = sequence + 1
  const review = state(video)
  review.segmentOverrides[`${segmentId}:${trackId}`] = personId
  review.lockedPersonIds = [...new Set([...review.lockedPersonIds, personId])]
  applyManualIdentityReview(video)
  task.updatedAt = new Date().toISOString()
  return { task, personId }
}

export function setIdentityLock(task: AnnotateSet, videoId: string, personId: string, locked: boolean): AnnotateSet {
  const video = task.videos.find(item => item.videoId === videoId)
  if (!video) throw new IdentityReviewError('VIDEO_NOT_FOUND', 404, 'Video not found')
  const review = state(video)
  review.lockedPersonIds = locked ? [...new Set([...review.lockedPersonIds, personId])] : review.lockedPersonIds.filter(id => id !== personId)
  task.updatedAt = new Date().toISOString()
  return task
}

export function collectVideoIdentities(video: VideoTaskItem) {
  const items = new Map<string, { personId: string; segments: number[]; tracks: number[]; locked: boolean }>()
  for (const segment of video.segments || []) {
    const annotation: SegmentAnnotation | null = segment.humanAnnotation || segment.modelAnnotation
    for (const person of annotation?.persons || []) {
      if (!person.personId) continue
      const item = items.get(person.personId) || { personId: person.personId, segments: [], tracks: [], locked: false }
      if (!item.segments.includes(segment.segmentId)) item.segments.push(segment.segmentId)
      if (!item.tracks.includes(person.trackId)) item.tracks.push(person.trackId)
      item.locked = Boolean(video.identityReview?.lockedPersonIds.includes(person.personId))
      items.set(person.personId, item)
    }
  }
  return [...items.values()].sort((a, b) => a.personId.localeCompare(b.personId))
}
