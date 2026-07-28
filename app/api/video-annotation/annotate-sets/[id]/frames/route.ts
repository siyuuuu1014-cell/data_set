import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import type { NextRequest } from 'next/server'
import type { AnnotateSet, SegmentAnnotation } from '@/services/video-annotation/types'
import { getTaskPath } from '@/services/video-annotation/server-paths'
import { withTaskFileLock } from '@/services/video-annotation/task-file-lock'
import { withDerivedAnnotationStatuses } from '@/services/video-annotation/status'

interface FramePatchBody {
  videoId?: unknown
  segmentId?: unknown
  annotation?: unknown
  updates?: unknown
}

interface AnnotationUpdate {
  segmentId: number
  annotation: SegmentAnnotation
}

function isSegmentAnnotation(value: unknown): value is SegmentAnnotation {
  if (!value || typeof value !== 'object') return false
  const annotation = value as Partial<SegmentAnnotation>
  if (!Array.isArray(annotation.persons) || !Array.isArray(annotation.objects)) return false
  if (annotation.frames !== undefined && !Array.isArray(annotation.frames)) return false
  return (annotation.frames || []).every(frame => (
    Number.isInteger(frame.frameIndex)
    && Number.isFinite(frame.timestamp)
    && frame.timestamp >= 0
    && Number.isFinite(frame.imageWidth)
    && Number.isFinite(frame.imageHeight)
    && Array.isArray(frame.observations)
    && frame.observations.every(observation => (
      Number.isInteger(observation.trackId)
      && (observation.entityType === 'person' || observation.entityType === 'object')
      && observation.bbox
      && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(observation.bbox[key as keyof typeof observation.bbox]))
      && observation.bbox.width > 0
      && observation.bbox.height > 0
    ))
  ))
}

/** Persist one segment's frame edits without replacing the complete task document. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const taskPath = getTaskPath(id)
  if (!existsSync(taskPath)) {
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, { status: 404 })
  }

  const body = await req.json() as FramePatchBody
  const videoId = typeof body.videoId === 'string' ? body.videoId : ''
  const singleUpdate = typeof body.segmentId === 'number' && isSegmentAnnotation(body.annotation)
    ? [{ segmentId: body.segmentId, annotation: body.annotation }]
    : null
  const batchUpdates = Array.isArray(body.updates) && body.updates.length > 0 && body.updates.length <= 1000
    ? body.updates.map(value => {
      if (!value || typeof value !== 'object') return null
      const candidate = value as { segmentId?: unknown; annotation?: unknown }
      return typeof candidate.segmentId === 'number' && isSegmentAnnotation(candidate.annotation)
        ? { segmentId: candidate.segmentId, annotation: candidate.annotation }
        : null
    })
    : null
  const updates = singleUpdate || (batchUpdates?.every((value): value is AnnotationUpdate => value !== null) ? batchUpdates : null)
  if (!videoId || !updates || updates.some(update => !Number.isInteger(update.segmentId))) {
    return Response.json({ error: { code: 'VALIDATION', message: 'Invalid frame annotation patch' } }, { status: 400 })
  }

  return withTaskFileLock(taskPath, async () => {
    const task = JSON.parse(await readFile(taskPath, 'utf-8')) as AnnotateSet
    const video = (task.videos || []).find(item => item.videoId === videoId)
    if (!video) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Video segment not found' } }, { status: 404 })
    }
    const updatesBySegment = new Map(updates.map(update => [update.segmentId, update.annotation]))
    if (updatesBySegment.size !== updates.length || [...updatesBySegment.keys()].some(segmentId => (
      !video.segments.some(segment => segment.segmentId === segmentId)
    ))) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Video segment not found' } }, { status: 404 })
    }
    for (const segment of video.segments) {
      const annotation = updatesBySegment.get(segment.segmentId)
      if (annotation) segment.humanAnnotation = annotation
    }
    const updated = withDerivedAnnotationStatuses({
      ...task,
      updatedAt: new Date().toISOString(),
    })
    await writeFile(taskPath, JSON.stringify(updated, null, 2))
    return Response.json({ data: updated })
  })
}
