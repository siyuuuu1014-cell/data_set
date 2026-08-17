import { NextRequest } from 'next/server'
import { readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { getJobStatus } from '@/services/video-annotation/worker-client'
import type { AnnotateSet, SegmentAnnotation } from '@/services/video-annotation/types'
import { withDerivedAnnotationStatuses } from '@/services/video-annotation/status'
import { isUnsafePathError } from '@/services/server-paths'
import { getTaskDir, getTaskPath, getUploadDir, getVideoIdentityCachePath } from '@/services/video-annotation/server-paths'
import { withTaskFileLock, writeTaskFileAtomic } from '@/services/video-annotation/task-file-lock'
import { applyCompletedModelResult, applyIdentityAliasesToVideo } from '@/services/video-annotation/model-result'
import { repairLegacyMultipartFilename } from '@/services/video-annotation/upload-stream'
import { repairLegacyOcrObjectCollisions } from '@/services/video-annotation/annotation-migrations'
import { assignMissingManualPersonIds } from '@/services/video-annotation/manual-track'
import { applyManualIdentityReview } from '@/services/video-annotation/identity-review'

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
                // Update the in-memory phase only (returned to the client);
                // do NOT persist it — progress phases change on nearly every
                // poll and would rewrite the whole task file each time.
                s.progressPhase = wStatus.progressDetail
              }
            }
          } catch {
            // Worker unreachable is transient — keep the segment processing so
            // the next poll retries instead of permanently failing a running job
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = seg as any
            if (s.progressPhase !== 'worker_unreachable') {
              s.progressPhase = 'worker_unreachable'
            }
          }
        }
      }
      if (assignMissingManualPersonIds(task)) modified = true
      for (const video of task.videos || []) {
        if (applyManualIdentityReview(video)) modified = true
      }

      const normalizedTask = withDerivedAnnotationStatuses(task)
      const statusChanged = normalizedTask.status !== task.status || normalizedTask.videos.some((video, index) => video.status !== task.videos[index]?.status)
      if (modified || statusChanged) {
        // Compact JSON: smaller file, faster parse. Historical pretty-printed
        // files remain readable (JSON.parse is format-agnostic).
        await writeTaskFileAtomic(taskPath, JSON.stringify(normalizedTask))
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
    // Lightweight shape validation: videos must be a well-formed array and
    // scalar fields must keep their types, so a corrupt/abusive body cannot
    // wipe or corrupt the task document.
    if (body.videos !== undefined && (!Array.isArray(body.videos) || body.videos.some(v => !v || typeof v.videoId !== 'string'))) {
      return Response.json({ error: { code: 'VALIDATION', message: 'Invalid videos payload' } }, { status: 400 })
    }
    for (const key of ['name', 'status'] as const) {
      const value = body[key]
      if (value !== undefined && typeof value !== 'string') {
        return Response.json({ error: { code: 'VALIDATION', message: `Invalid ${key} payload` } }, { status: 400 })
      }
    }
    return await withTaskFileLock(taskPath, async () => {
      const raw = await readFile(taskPath, 'utf-8')
      const task = JSON.parse(raw) as AnnotateSet
      // The client round-trips in-memory progressPhase (transient display
      // data) back to us on full PUTs; strip it so the "progress is not
      // persisted" contract survives, otherwise every delete while another
      // segment is processing would write a stale phase to disk.
      const strippedVideos = (body.videos || []).map(video => ({
        ...video,
        segments: (video.segments || []).map(segment => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { progressPhase, ...rest } = segment
          return rest
        }),
      }))
      const updated = withDerivedAnnotationStatuses({
        ...task,
        ...body,
        videos: strippedVideos,
        id,
        updatedAt: new Date().toISOString(),
      } as AnnotateSet)
      await writeTaskFileAtomic(taskPath, JSON.stringify(updated, null, 2))
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
    if (!existsSync(taskDir)) {
      return Response.json({ success: true })
    }

    // Collect owned video IDs from the task file before it is removed, then
    // best-effort clean up each video's uploads and identity cache — the same
    // derived-file cleanup the per-video DELETE performs.
    const videoIds: string[] = []
    const taskPath = getTaskPath(id)
    if (existsSync(taskPath)) {
      await withTaskFileLock(taskPath, async () => {
        try {
          const task = JSON.parse(await readFile(taskPath, 'utf-8')) as AnnotateSet
          for (const video of task.videos || []) {
            if (typeof video.videoId === 'string') videoIds.push(video.videoId)
          }
        } catch {
          // Corrupt task file: nothing to recover — proceed with directory removal
        }
      })
    }

    const cleanup = await Promise.allSettled(videoIds.map(async videoId => {
      // videoId originates from a task file, so it must be validated before
      // it is used to build any filesystem path.
      const uploadDir = getUploadDir(videoId)
      const identityPath = getVideoIdentityCachePath(videoId)
      const identityLockPath = identityPath.replace(/\.json$/i, '.lock')
      await Promise.allSettled([
        rm(uploadDir, { recursive: true, force: true }),
        rm(identityPath, { force: true }),
        rm(identityLockPath, { force: true }),
      ])
    }))
    const cleanupPending = cleanup.some(result => result.status === 'rejected')

    await rm(taskDir, { recursive: true, force: true })
    return Response.json({ success: true, cleanupPending })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}
