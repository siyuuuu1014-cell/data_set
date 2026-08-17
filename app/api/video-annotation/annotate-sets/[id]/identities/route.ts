import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import type { NextRequest } from 'next/server'
import type { AnnotateSet } from '@/services/video-annotation/types'
import { assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'
import { getTaskPath } from '@/services/video-annotation/server-paths'
import { withTaskFileLock, writeTaskFileAtomic } from '@/services/video-annotation/task-file-lock'
import { IdentityReviewError, mergeVideoPeople, setIdentityLock, splitVideoPerson } from '@/services/video-annotation/identity-review'

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
      let personId: string | undefined
      if (body.action === 'merge' && typeof body.sourceId === 'string' && typeof body.targetId === 'string') task = mergeVideoPeople(task, body.videoId as string, body.sourceId, body.targetId)
      else if (body.action === 'split' && Number.isInteger(body.segmentId) && Number.isInteger(body.trackId)) {
        const result = splitVideoPerson(task, body.videoId as string, body.segmentId as number, body.trackId as number); task = result.task; personId = result.personId
      } else if (body.action === 'lock' && typeof body.personId === 'string' && typeof body.locked === 'boolean') task = setIdentityLock(task, body.videoId as string, body.personId, body.locked)
      else return Response.json({ error: { code: 'VALIDATION', message: 'Invalid identity action' } }, { status: 400 })
      await writeTaskFileAtomic(taskPath, JSON.stringify(task, null, 2))
      return Response.json({ data: task, personId })
    })
  } catch (error) {
    if (error instanceof IdentityReviewError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    if (isUnsafePathError(error)) return Response.json({ error: { code: 'VALIDATION', message: error.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(error) } }, { status: 500 })
  }
}
