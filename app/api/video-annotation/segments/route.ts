import { NextRequest } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { submitJob, getJobStatus } from '@/services/video-annotation/worker-client'
import { getVideoMetadata } from '@/services/video-annotation/segment-service'
import { assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'
import { getTaskPath, getUploadDir, getUploadFile } from '@/services/video-annotation/server-paths'
import { withTaskFileLock, writeTaskFileAtomic } from '@/services/video-annotation/task-file-lock'

// POST /api/video-annotation/segments — detect scenes for a video
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { annotateSetId: string; videoId: string; sceneThreshold?: number }
    if (!body.annotateSetId || !body.videoId) {
      return Response.json({ error: { code: 'VALIDATION', message: 'annotateSetId and videoId required' } }, { status: 400 })
    }
    assertSafeIdentifier(body.annotateSetId, 'annotation set ID')
    assertSafeIdentifier(body.videoId, 'video ID')

    const videoDir = getUploadDir(body.videoId)
    if (!existsSync(videoDir)) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Video directory not found' } }, { status: 404 })
    }

    const files = await readdir(videoDir)
    const videoFile = files.find((f: string) => f.startsWith('source.'))
    if (!videoFile) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Video file not found' } }, { status: 404 })
    }

    const videoPath = getUploadFile(body.videoId, videoFile)

    // Get metadata via ffprobe
    let metadata
    try {
      metadata = await getVideoMetadata(videoPath)
    } catch {
      return Response.json({ error: { code: 'VIDEO_METADATA_FAILED', message: 'Failed to read video metadata' } }, { status: 500 })
    }

    // Trigger scene detection via worker
    const safeThreshold = Math.max(0.01, body.sceneThreshold ?? 0.4)
    const jobId = await submitJob({
      video_path: videoPath,
      segment_start: 0,
      segment_end: metadata.duration,
      options: { mode: 'scene_detect', scene_threshold: safeThreshold },
    })

    // Poll for result. Transient worker errors (restart, network blip) are
    // retried instead of failing the whole detection.
    let result: Record<string, unknown> | null = null
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const status = await getJobStatus(jobId)
        if (status.status === 'completed') {
          result = status.result as Record<string, unknown> | null
          break
        }
        if (status.status === 'failed') {
          return Response.json({ error: { code: 'SCENE_DETECTION_FAILED', message: status.error || 'Scene detection failed' } }, { status: 500 })
        }
      } catch (pollErr) {
        console.error('[segments] scene detection poll error (retrying):', pollErr)
      }
    }

    if (!result) {
      return Response.json({ error: { code: 'SCENE_DETECTION_FAILED', message: 'No segments detected' } }, { status: 500 })
    }

    // result from scene_detect is { segments: [{segment_id, start, end}, ...], metadata: {duration, fps, width, height} }
    const segments = result.segments as Array<{ segment_id: number; start: number; end: number }> | undefined
    if (!segments || segments.length === 0) {
      return Response.json({ error: { code: 'SCENE_DETECTION_FAILED', message: 'No segments detected' } }, { status: 500 })
    }

    // Update annotate set with segments and metadata
    const taskPath = getTaskPath(body.annotateSetId)
    if (existsSync(taskPath)) {
      await withTaskFileLock(taskPath, async () => {
        const raw = await readFile(taskPath, 'utf-8')
        let task: Record<string, unknown>
        try {
          task = JSON.parse(raw) as Record<string, unknown>
        } catch {
          throw new Error('Annotation task file is corrupted and cannot be read')
        }
        const videos = task.videos as Array<Record<string, unknown>> | undefined
        const vid = videos?.find((v: Record<string, unknown>) => v.videoId === body.videoId)
        if (vid) {
          vid.segments = segments.map((s) => ({
            segmentId: s.segment_id,
            start: s.start,
            end: s.end,
            status: 'draft',
            modelAnnotation: null,
            humanAnnotation: null,
          }))
          vid.duration = metadata.duration
          vid.fps = metadata.fps
          vid.width = metadata.width
          vid.height = metadata.height
          await writeTaskFileAtomic(taskPath, JSON.stringify(task, null, 2))
        }
      })
    }

    return Response.json({ data: segments })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}
