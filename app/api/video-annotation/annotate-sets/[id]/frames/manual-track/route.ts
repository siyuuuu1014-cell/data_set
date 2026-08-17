import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { NextRequest } from 'next/server'
import type { AddManualTrackInput } from '@/services/video-annotation/manual-track'
import { addManualTrack, ManualTrackError } from '@/services/video-annotation/manual-track'
import { getTaskPath } from '@/services/video-annotation/server-paths'
import { withDerivedAnnotationStatuses } from '@/services/video-annotation/status'
import { withTaskFileLock, writeTaskFileAtomic } from '@/services/video-annotation/task-file-lock'
import type { AnnotateSet, BBox, SpatialEntityType } from '@/services/video-annotation/types'

interface ManualTrackBody {
  videoId?: unknown
  segmentId?: unknown
  frameIndex?: unknown
  timestamp?: unknown
  imageWidth?: unknown
  imageHeight?: unknown
  entityType?: unknown
  className?: unknown
  bbox?: unknown
}

function parseBody(body: ManualTrackBody): AddManualTrackInput | null {
  const bbox = body.bbox as Partial<BBox> | null
  if (
    typeof body.videoId !== 'string'
    || typeof body.segmentId !== 'number'
    || typeof body.frameIndex !== 'number'
    || typeof body.timestamp !== 'number'
    || typeof body.imageWidth !== 'number'
    || typeof body.imageHeight !== 'number'
    || (body.entityType !== 'person' && body.entityType !== 'object')
    || typeof body.className !== 'string'
    || !bbox
    || !['x', 'y', 'width', 'height'].every(key => typeof bbox[key as keyof BBox] === 'number')
  ) return null
  return {
    videoId: body.videoId,
    segmentId: body.segmentId,
    frameIndex: body.frameIndex,
    timestamp: body.timestamp,
    imageWidth: body.imageWidth,
    imageHeight: body.imageHeight,
    entityType: body.entityType as SpatialEntityType,
    className: body.className,
    bbox: bbox as BBox,
  }
}

/** Atomically allocate and persist one manually drawn Track. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const taskPath = getTaskPath(id)
  if (!existsSync(taskPath)) {
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, { status: 404 })
  }
  const input = parseBody(await req.json() as ManualTrackBody)
  if (!input) {
    return Response.json({ error: { code: 'VALIDATION', message: 'Invalid manual Track request' } }, { status: 400 })
  }

  try {
    return await withTaskFileLock(taskPath, async () => {
      const task = JSON.parse(await readFile(taskPath, 'utf8')) as AnnotateSet
      const result = addManualTrack(task, input)
      const updated = withDerivedAnnotationStatuses({
        ...result.task,
        updatedAt: new Date().toISOString(),
      })
      await writeTaskFileAtomic(taskPath, JSON.stringify(updated, null, 2))
      return Response.json({
        data: updated,
        manualTrack: { trackId: result.trackId, personId: result.personId },
      })
    })
  } catch (error) {
    if (error instanceof ManualTrackError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    }
    return Response.json({ error: { code: 'INTERNAL', message: String(error) } }, { status: 500 })
  }
}
