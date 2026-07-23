import { NextRequest } from 'next/server'
import { readFile, writeFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { submitJob, getJobStatus } from '@/services/video-annotation/worker-client'
import { assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'
import { getTaskPath, getUploadDir, getUploadFile } from '@/services/video-annotation/server-paths'

// POST /api/video-annotation/segments/[id]/annotate — trigger annotation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const segmentId = (await params).id
  try {
    const body = await req.json() as { annotateSetId: string; videoId: string; start: number; end: number }
    assertSafeIdentifier(body.annotateSetId, 'annotation set ID')
    assertSafeIdentifier(body.videoId, 'video ID')
    if (!/^\d+$/.test(segmentId)) {
      return Response.json({ error: { code: 'VALIDATION', message: 'Invalid segment ID' } }, { status: 400 })
    }

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
      options: {
        sample_fps: 0.5,
        ontology: {},
        video_id: body.videoId,
        segment_id: parseInt(segmentId, 10),
      },
    })

    // Store jobId mapping
    const taskPath = getTaskPath(body.annotateSetId)
    if (existsSync(taskPath)) {
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
          await writeFile(taskPath, JSON.stringify(task, null, 2))
        }
      }
    }

    return Response.json({ data: { jobId, segmentId } }, { status: 202 })
  } catch (err) {
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

    // If completed, save result
    if (status.status === 'completed' && status.result && existsSync(taskPath)) {
      const raw = await readFile(taskPath, 'utf-8')
      const task = JSON.parse(raw)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
      const vid = task.videos?.find((v: any) => v.videoId === videoId)
      if (vid) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from file
        const seg = vid.segments?.find((s: any) => s.segmentId === parseInt(segmentId))
        if (seg) {
          seg.modelAnnotation = status.result
          seg.status = 'completed'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (seg as any).humanAnnotation  // clear stale human edits — model regenerated
          await writeFile(taskPath, JSON.stringify(task, null, 2))
        }
      }
    }

    return Response.json({ data: status })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}
