import { NextRequest } from 'next/server'
import { readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { submitJob, getJobStatus, workerDeployment } from '@/services/video-annotation/worker-client'
import { assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'
import { getTaskPath, getUploadDir, getUploadFile } from '@/services/video-annotation/server-paths'
import { withTaskFileLock, writeTaskFileAtomic } from '@/services/video-annotation/task-file-lock'
import { applyCompletedModelResult, applyIdentityAliasesToVideo } from '@/services/video-annotation/model-result'
import { applyManualIdentityReview } from '@/services/video-annotation/identity-review'
import {
  buildAnnotationOptions,
  buildReviewTrackCandidates,
  precisionAvailabilityError,
} from '@/services/video-annotation/annotation-options'
import type { AnnotateSet, AnnotationExecutionMode, SegmentState } from '@/services/video-annotation/types'

class SegmentBusyError extends Error {
  constructor() {
    super('Segment is already being annotated')
    this.name = 'SegmentBusyError'
  }
}

// POST /api/video-annotation/segments/[id]/annotate — trigger annotation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const segmentId = (await params).id
  try {
    const body = await req.json() as {
      annotateSetId: string
      videoId: string
      start: number
      end: number
      mode?: AnnotationExecutionMode
    }
    assertSafeIdentifier(body.annotateSetId, 'annotation set ID')
    assertSafeIdentifier(body.videoId, 'video ID')
    if (!/^\d+$/.test(segmentId)) {
      return Response.json({ error: { code: 'VALIDATION', message: 'Invalid segment ID' } }, { status: 400 })
    }
    if (body.mode !== undefined && body.mode !== 'standard' && body.mode !== 'precision') {
      return Response.json({ error: { code: 'VALIDATION', message: 'Invalid annotation mode' } }, { status: 400 })
    }
    const mode: AnnotationExecutionMode = body.mode || 'standard'
    if (mode === 'precision') {
      let deployment
      try {
        deployment = await workerDeployment()
      } catch (error) {
        return Response.json(
          {
            error: {
              code: 'WORKER_UNAVAILABLE',
              message: error instanceof Error ? error.message : 'Worker not reachable',
            },
          },
          { status: 503 },
        )
      }
      const unavailable = precisionAvailabilityError(deployment)
      if (unavailable) {
        return Response.json(
          { error: { code: 'PRECISION_UNAVAILABLE', message: unavailable } },
          { status: 409 },
        )
      }
    }

    const taskPath = getTaskPath(body.annotateSetId)
    if (!existsSync(taskPath)) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, { status: 404 })
    }
    // Validate boundaries before touching the worker: non-finite or inverted
    // ranges would otherwise produce corrupt jobs.
    if (!Number.isFinite(body.start) || !Number.isFinite(body.end) || body.start < 0 || body.end <= body.start) {
      return Response.json({ error: { code: 'VALIDATION', message: 'Invalid segment range' } }, { status: 400 })
    }

    // Pre-check segment existence and status under the lock so a missing or
    // already-processing segment never produces an orphan worker job.
    let segmentExists = false
    await withTaskFileLock(taskPath, async () => {
      const raw = await readFile(taskPath, 'utf-8')
      const task = JSON.parse(raw) as AnnotateSet
      const segment = task.videos
        ?.find(video => video.videoId === body.videoId)
        ?.segments?.find(item => item.segmentId === parseInt(segmentId, 10)) as SegmentState | undefined
      segmentExists = Boolean(segment)
      if (segment?.status === 'processing') {
        throw new SegmentBusyError()
      }
    })
    if (!segmentExists) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Segment not found' } }, { status: 404 })
    }

    const reviewCandidates = await withTaskFileLock(taskPath, async () => {
      const raw = await readFile(taskPath, 'utf-8')
      const task = JSON.parse(raw) as AnnotateSet
      const segment = task.videos
        ?.find(video => video.videoId === body.videoId)
        ?.segments?.find(item => item.segmentId === parseInt(segmentId, 10)) as SegmentState | undefined
      return segment ? buildReviewTrackCandidates(segment) : []
    })

    // Find video file
    const videoDir = getUploadDir(body.videoId)
    const files = await readdir(videoDir)
    const videoFile = files.find((f: string) => f.startsWith('source.'))
    if (!videoFile) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Video file not found' } }, { status: 404 })
    }

    const videoPath = getUploadFile(body.videoId, videoFile)

    // Submit to worker
    const jobId = await submitJob({
      video_path: videoPath,
      segment_start: body.start,
      segment_end: body.end,
      options: buildAnnotationOptions({
        videoId: body.videoId,
        segmentId: parseInt(segmentId, 10),
        mode,
        reviewCandidates,
      }),
    })

    // Store jobId mapping
    await withTaskFileLock(taskPath, async () => {
      if (!existsSync(taskPath)) return
      const raw = await readFile(taskPath, 'utf-8')
      const task = JSON.parse(raw)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
      const vid = task.videos?.find((v: any) => v.videoId === body.videoId)
      if (vid) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
        const seg = vid.segments?.find((s: any) => s.segmentId === parseInt(segmentId))
        if (seg) {
          seg.workerJobId = jobId
          seg.status = 'processing'
          seg.processingMode = mode
          delete seg.error
          delete seg.progressPhase
          await writeTaskFileAtomic(taskPath, JSON.stringify(task, null, 2))
        }
      }
    })

    return Response.json({ data: { jobId, segmentId, mode } }, { status: 202 })
  } catch (err) {
    if (err instanceof SegmentBusyError) {
      return Response.json({ error: { code: 'SEGMENT_BUSY', message: err.message } }, { status: 409 })
    }
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}

// GET /api/video-annotation/segments/[id]/status — poll annotation status
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const segmentId = (await params).id
  try {
    // Read jobId from task file
    const annotateSetId = _req.nextUrl.searchParams.get('annotateSetId') || ''
    const videoId = _req.nextUrl.searchParams.get('videoId') || ''
    assertSafeIdentifier(annotateSetId, 'annotation set ID')
    assertSafeIdentifier(videoId, 'video ID')
    if (!/^\d+$/.test(segmentId)) {
      return Response.json({ error: { code: 'VALIDATION', message: 'Invalid segment ID' } }, { status: 400 })
    }
    const taskPath = getTaskPath(annotateSetId)

    return await withTaskFileLock(taskPath, async () => {
      let jobId: string | null = null
      if (existsSync(taskPath)) {
        const raw = await readFile(taskPath, 'utf-8')
        const task = JSON.parse(raw)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
        const vid = task.videos?.find((v: any) => v.videoId === videoId)
        if (vid) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
          const seg = vid.segments?.find((s: any) => s.segmentId === parseInt(segmentId))
          if (seg?.workerJobId) {
            jobId = seg.workerJobId
          }
        }
      }

      if (!jobId) {
        return Response.json({ data: { status: 'draft' } })
      }

      const status = await getJobStatus(jobId)

      // If completed, save result. Re-check the ID before writing so an old
      // poll can never overwrite a newly submitted retry.
      if (status.status === 'completed' && status.result && existsSync(taskPath)) {
        const raw = await readFile(taskPath, 'utf-8')
        const task = JSON.parse(raw)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
        const vid = task.videos?.find((v: any) => v.videoId === videoId)
        if (vid) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
          const seg = vid.segments?.find((s: any) => s.segmentId === parseInt(segmentId))
          if (seg?.workerJobId === jobId) {
            applyCompletedModelResult(seg, status.result)
            applyIdentityAliasesToVideo(vid, status.result._identity_aliases)
            applyManualIdentityReview(vid)
            await writeTaskFileAtomic(taskPath, JSON.stringify(task, null, 2))
          }
        }
      } else if (status.status === 'failed' && existsSync(taskPath)) {
        const raw = await readFile(taskPath, 'utf-8')
        const task = JSON.parse(raw)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
        const vid = task.videos?.find((v: any) => v.videoId === videoId)
        if (vid) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
          const seg = vid.segments?.find((s: any) => s.segmentId === parseInt(segmentId))
          if (seg?.workerJobId === jobId) {
            seg.status = 'failed'
            seg.error = status.error || 'Unknown error'
            delete seg.processingMode
            await writeTaskFileAtomic(taskPath, JSON.stringify(task, null, 2))
          }
        }
      }

      return Response.json({ data: status })
    })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}
