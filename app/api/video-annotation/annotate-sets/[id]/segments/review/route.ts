import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import type { NextRequest } from 'next/server'
import type { AnnotateSet, ReviewStatus } from '@/services/video-annotation/types'
import { assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'
import { getTaskPath } from '@/services/video-annotation/server-paths'
import { withTaskFileLock, writeTaskFileAtomic } from '@/services/video-annotation/task-file-lock'
import { withDerivedAnnotationStatuses } from '@/services/video-annotation/status'

const statuses = new Set<ReviewStatus>(['unreviewed', 'needs_review', 'modified', 'approved', 'rejected'])
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json() as { videoId?: unknown; segmentId?: unknown; status?: unknown }
    if (typeof body.videoId !== 'string' || !Number.isInteger(body.segmentId) || typeof body.status !== 'string' || !statuses.has(body.status as ReviewStatus)) return Response.json({ error: { code: 'VALIDATION', message: 'Invalid review update' } }, { status: 400 })
    assertSafeIdentifier(id, 'annotation set ID'); assertSafeIdentifier(body.videoId, 'video ID')
    const path = getTaskPath(id); if (!existsSync(path)) return Response.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, { status: 404 })
    return await withTaskFileLock(path, async () => {
      const task = JSON.parse(await readFile(path, 'utf-8')) as AnnotateSet
      const segment = task.videos.find(v => v.videoId === body.videoId)?.segments.find(s => s.segmentId === body.segmentId)
      if (!segment) return Response.json({ error: { code: 'NOT_FOUND', message: 'Segment not found' } }, { status: 404 })
      segment.reviewStatus = body.status as ReviewStatus
      task.updatedAt = new Date().toISOString()
      const updated = withDerivedAnnotationStatuses(task)
      await writeTaskFileAtomic(path, JSON.stringify(updated, null, 2))
      return Response.json({ data: updated })
    })
  } catch (error) {
    if (isUnsafePathError(error)) return Response.json({ error: { code: 'VALIDATION', message: error.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(error) } }, { status: 500 })
  }
}
