import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import type { NextRequest } from 'next/server'
import type { AnnotateSet } from '@/services/video-annotation/types'
import { assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'
import { getTaskPath } from '@/services/video-annotation/server-paths'
import { withTaskFileLock, writeTaskFileAtomic } from '@/services/video-annotation/task-file-lock'
import { adjustSegmentBoundary, mergeAdjacentSegments, SegmentTimelineError, splitAnnotatedSegment, undoTimelineEdit } from '@/services/video-annotation/segment-timeline'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    assertSafeIdentifier(id, 'annotation set ID')
    const body = await req.json() as Record<string, unknown>
    if (typeof body.videoId !== 'string') return Response.json({ error: { code: 'VALIDATION', message: 'videoId is required' } }, { status: 400 })
    assertSafeIdentifier(body.videoId, 'video ID')
    const taskPath = getTaskPath(id)
    if (!existsSync(taskPath)) return Response.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, { status: 404 })
    return await withTaskFileLock(taskPath, async () => {
      let task = JSON.parse(await readFile(taskPath, 'utf-8')) as AnnotateSet
      const preserve = body.preserve === 'left' || body.preserve === 'right' ? body.preserve : 'none'
      if (body.action === 'split' && Number.isInteger(body.segmentId) && typeof body.time === 'number') task = splitAnnotatedSegment(task, body.videoId as string, body.segmentId as number, body.time, preserve)
      else if (body.action === 'merge' && Number.isInteger(body.segmentId)) task = mergeAdjacentSegments(task, body.videoId as string, body.segmentId as number, preserve)
      else if (body.action === 'adjust' && Number.isInteger(body.segmentId) && typeof body.time === 'number') task = adjustSegmentBoundary(task, body.videoId as string, body.segmentId as number, body.time)
      else if (body.action === 'undo') task = undoTimelineEdit(task, body.videoId as string)
      else return Response.json({ error: { code: 'VALIDATION', message: 'Invalid timeline action' } }, { status: 400 })
      await writeTaskFileAtomic(taskPath, JSON.stringify(task, null, 2))
      return Response.json({ data: task })
    })
  } catch (error) {
    if (error instanceof SegmentTimelineError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    if (isUnsafePathError(error)) return Response.json({ error: { code: 'VALIDATION', message: error.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(error) } }, { status: 500 })
  }
}
