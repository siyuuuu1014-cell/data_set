import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import type { NextRequest } from 'next/server'
import type { AnnotateSet } from '@/services/video-annotation/types'
import { assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'
import { getTaskPath } from '@/services/video-annotation/server-paths'
import { withTaskFileLock, writeTaskFileAtomic } from '@/services/video-annotation/task-file-lock'
import { SegmentSplitError, splitDraftVideoSegment } from '@/services/video-annotation/segment-split'

interface SplitBody {
  videoId?: unknown
  segmentId?: unknown
  splitTime?: unknown
}

/** Split one untouched draft segment at a frame-snapped timestamp. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const body = await req.json() as SplitBody
    if (
      typeof body.videoId !== 'string'
      || typeof body.segmentId !== 'number'
      || !Number.isInteger(body.segmentId)
      || typeof body.splitTime !== 'number'
      || !Number.isFinite(body.splitTime)
    ) {
      return Response.json({ error: { code: 'VALIDATION', message: 'videoId, integer segmentId, and finite splitTime are required' } }, { status: 400 })
    }
    assertSafeIdentifier(id, 'annotation set ID')
    assertSafeIdentifier(body.videoId, 'video ID')

    const taskPath = getTaskPath(id)
    if (!existsSync(taskPath)) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, { status: 404 })
    }

    return await withTaskFileLock(taskPath, async () => {
      const task = JSON.parse(await readFile(taskPath, 'utf-8')) as AnnotateSet
      const result = splitDraftVideoSegment(task, body.videoId as string, body.segmentId as number, body.splitTime as number)
      await writeTaskFileAtomic(taskPath, JSON.stringify(result.task, null, 2))
      return Response.json({
        data: result.task,
        split: {
          splitTime: result.splitTime,
          leftSegmentId: result.leftSegmentId,
          rightSegmentId: result.rightSegmentId,
        },
      })
    })
  } catch (error) {
    if (error instanceof SegmentSplitError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    }
    if (isUnsafePathError(error)) {
      return Response.json({ error: { code: 'VALIDATION', message: error.message } }, { status: 400 })
    }
    return Response.json({ error: { code: 'INTERNAL', message: String(error) } }, { status: 500 })
  }
}
