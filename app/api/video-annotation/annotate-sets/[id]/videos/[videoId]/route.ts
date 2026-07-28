import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { NextRequest } from 'next/server'

import { isUnsafePathError } from '@/services/server-paths'
import {
  getTaskPath,
  getUploadDir,
  getVideoIdentityCachePath,
} from '@/services/video-annotation/server-paths'
import { withTaskFileLock } from '@/services/video-annotation/task-file-lock'
import type { AnnotateSet } from '@/services/video-annotation/types'
import {
  removeVideoFromAnnotationSet,
  VideoRemovalError,
} from '@/services/video-annotation/status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE one video and its derived local files from an annotation project.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; videoId: string }> },
) {
  const { id, videoId } = await params
  try {
    const taskPath = getTaskPath(id)
    const uploadDir = getUploadDir(videoId)
    const identityPath = getVideoIdentityCachePath(videoId)
    const identityLockPath = identityPath.replace(/\.json$/i, '.lock')

    if (!existsSync(taskPath)) {
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'Task not found' } },
        { status: 404 },
      )
    }

    return await withTaskFileLock(taskPath, async () => {
      const task = JSON.parse(await readFile(taskPath, 'utf8')) as AnnotateSet
      const updated = removeVideoFromAnnotationSet(task, videoId)

      // Commit the project update first. If best-effort cache cleanup is ever
      // blocked by an external process, the deleted video cannot reappear in
      // the project and cleanup can safely be retried.
      await writeFile(taskPath, JSON.stringify(updated, null, 2))
      const cleanup = await Promise.allSettled([
        rm(uploadDir, { recursive: true, force: true }),
        rm(identityPath, { force: true }),
        rm(identityLockPath, { force: true }),
      ])
      const cleanupPending = cleanup.some(result => result.status === 'rejected')

      return Response.json({ data: updated, cleanupPending })
    })
  } catch (error) {
    if (error instanceof VideoRemovalError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      )
    }
    if (isUnsafePathError(error)) {
      return Response.json(
        { error: { code: 'VALIDATION', message: error.message } },
        { status: 400 },
      )
    }
    return Response.json(
      { error: { code: 'INTERNAL', message: String(error) } },
      { status: 500 },
    )
  }
}
