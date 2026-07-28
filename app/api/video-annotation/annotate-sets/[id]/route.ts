import { NextRequest } from 'next/server'
import { readFile, writeFile, rmdir } from 'fs/promises'
import { existsSync } from 'fs'
import { getJobStatus } from '@/services/video-annotation/worker-client'
import type { AnnotateSet, SegmentAnnotation } from '@/services/video-annotation/types'
import { withDerivedAnnotationStatuses } from '@/services/video-annotation/status'
import { isUnsafePathError } from '@/services/server-paths'
import { getTaskDir, getTaskPath } from '@/services/video-annotation/server-paths'
import { withTaskFileLock } from '@/services/video-annotation/task-file-lock'
import { applyCompletedModelResult, applyIdentityAliasesToVideo } from '@/services/video-annotation/model-result'
import { repairLegacyMultipartFilename } from '@/services/video-annotation/upload-stream'
import { repairLegacyOcrObjectCollisions } from '@/services/video-annotation/annotation-migrations'

// GET /api/video-annotation/annotate-sets/[id]
// Always polls Worker for processing segments and syncs results.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const taskPath = getTaskPath(id)
    if (!existsSync(taskPath)) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, { status: 404 })
    }
    return await withTaskFileLock(taskPath, async () => {
      const raw = await readFile(taskPath, 'utf-8')
      const task = JSON.parse(raw) as AnnotateSet

      let modified = false
      for (const vid of (task.videos || [])) {
        const repairedFileName = repairLegacyMultipartFilename(vid.fileName)
        if (repairedFileName !== vid.fileName) {
          vid.fileName = repairedFileName
          modified = true
        }
        for (const seg of (vid.segments || [])) {
          if (seg.modelAnnotation) {
            const migratedModel = repairLegacyOcrObjectCollisions(seg.modelAnnotation)
            if (migratedModel.changed) {
              seg.modelAnnotation = migratedModel.annotation
              modified = true
            }
          }
          if (seg.humanAnnotation) {
            const migratedHuman = repairLegacyOcrObjectCollisions(
              seg.humanAnnotation,
              seg.modelAnnotation,
            )
            if (migratedHuman.changed) {
              seg.humanAnnotation = migratedHuman.annotation
              modified = true
            }
          }
          if (seg.status !== 'processing') continue

          const jobId = (seg as unknown as Record<string, unknown>).workerJobId as string | undefined
          if (!jobId) {
            // Never had a job — stale processing marker
            seg.status = 'failed'
            modified = true
            continue
          }

          try {
            const wStatus = await getJobStatus(jobId)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = seg as any
            if (wStatus.status === 'completed' && wStatus.result) {
              applyCompletedModelResult(s, wStatus.result as SegmentAnnotation)
              applyIdentityAliasesToVideo(vid, wStatus.result._identity_aliases)
              modified = true
            } else if (wStatus.status === 'failed') {
              s.status = 'failed'
              s.error = wStatus.error || 'Unknown error'
              delete s.processingMode
              modified = true
            } else if (wStatus.status === 'processing') {
              if (wStatus.progressDetail) {
                s.progressPhase = wStatus.progressDetail
                modified = true
              }
            }
          } catch {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = seg as any
            s.status = 'failed'
            s.error = 'Worker unreachable'
            delete s.processingMode
            modified = true
          }
        }
      }

      const normalizedTask = withDerivedAnnotationStatuses(task)
      const statusChanged = normalizedTask.status !== task.status || normalizedTask.videos.some((video, index) => video.status !== task.videos[index]?.status)
      if (modified || statusChanged) {
        await writeFile(taskPath, JSON.stringify(normalizedTask, null, 2))
      }

      return Response.json({ data: normalizedTask })
    })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}

// PUT /api/video-annotation/annotate-sets/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const taskPath = getTaskPath(id)
    if (!existsSync(taskPath)) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, { status: 404 })
    }

    const body = await req.json() as Partial<AnnotateSet>
    return await withTaskFileLock(taskPath, async () => {
      const raw = await readFile(taskPath, 'utf-8')
      const task = JSON.parse(raw) as AnnotateSet
      const updated = withDerivedAnnotationStatuses({ ...task, ...body, id, updatedAt: new Date().toISOString() } as AnnotateSet)
      await writeFile(taskPath, JSON.stringify(updated, null, 2))
      return Response.json({ data: updated })
    })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}

// DELETE /api/video-annotation/annotate-sets/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const taskDir = getTaskDir(id)
    if (existsSync(taskDir)) {
      await rmdir(taskDir, { recursive: true })
    }
    return Response.json({ success: true })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}
