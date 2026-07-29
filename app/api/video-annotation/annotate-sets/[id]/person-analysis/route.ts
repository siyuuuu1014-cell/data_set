import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import type { NextRequest } from 'next/server'
import { assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'
import { getTaskPath, getUploadDir, getUploadFile } from '@/services/video-annotation/server-paths'
import { getPersonAnalysisJobStatus, submitJob } from '@/services/video-annotation/worker-client'
import type { AnnotateSet, SegmentAnnotation } from '@/services/video-annotation/types'

interface PersonAnalysisRequest {
  videoId?: unknown
  segmentId?: unknown
  frameIndex?: unknown
  trackId?: unknown
}

function effectiveAnnotation(
  human: SegmentAnnotation | null,
  model: SegmentAnnotation | null,
): SegmentAnnotation | null {
  if (!human) return model
  const reviewed = Boolean(
    human._humanEdited
    || human.scene?.place?.type !== 'unknown'
    || human.persons?.some(person => person.gender !== 'unknown' || person.clothing.length > 0)
    || human.camera?.angle !== 'unknown'
    || human.events?.length
    || human.speechTranscript
    || human.objects?.some(object => Boolean(object.name && object.name !== 'unknown'))
    || human.persons?.length > (model?.persons?.length || 0)
    || human.objects?.length > (model?.objects?.length || 0)
  )
  return reviewed ? human : model || human
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    assertSafeIdentifier(id, 'annotation set ID')
    const body = await req.json() as PersonAnalysisRequest
    if (
      typeof body.videoId !== 'string'
      || !Number.isInteger(body.segmentId)
      || !Number.isInteger(body.frameIndex)
      || !Number.isInteger(body.trackId)
    ) {
      return Response.json({ error: { code: 'VALIDATION', message: 'Invalid person analysis request' } }, { status: 400 })
    }
    assertSafeIdentifier(body.videoId, 'video ID')
    const taskPath = getTaskPath(id)
    if (!existsSync(taskPath)) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Annotation task not found' } }, { status: 404 })
    }
    const task = JSON.parse(await readFile(taskPath, 'utf8')) as AnnotateSet
    const video = task.videos.find(item => item.videoId === body.videoId)
    const segment = video?.segments.find(item => item.segmentId === body.segmentId)
    const annotation = segment
      ? effectiveAnnotation(segment.humanAnnotation, segment.modelAnnotation)
      : null
    const frame = annotation?.frames?.find(item => item.frameIndex === body.frameIndex)
    const observation = frame?.observations.find(item => (
      item.entityType === 'person' && item.trackId === body.trackId
    ))
    if (!video || !segment || !annotation || !frame || !observation) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Selected person box was not found' } }, { status: 404 })
    }

    const files = await readdir(getUploadDir(video.videoId))
    const sourceFile = files.find(file => file.startsWith('source.'))
    if (!sourceFile) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Video source file not found' } }, { status: 404 })
    }
    const jobId = await submitJob({
      video_path: getUploadFile(video.videoId, sourceFile),
      segment_start: frame.timestamp,
      segment_end: frame.timestamp,
      options: {
        mode: 'person_analysis',
        bbox: observation.bbox,
        image_width: frame.imageWidth || video.width,
        image_height: frame.imageHeight || video.height,
      },
    })
    return Response.json({ data: { jobId } }, { status: 202 })
  } catch (error) {
    if (isUnsafePathError(error)) {
      return Response.json({ error: { code: 'VALIDATION', message: error.message } }, { status: 400 })
    }
    return Response.json({ error: { code: 'INTERNAL', message: String(error) } }, { status: 500 })
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    assertSafeIdentifier(id, 'annotation set ID')
    const jobId = req.nextUrl.searchParams.get('jobId') || ''
    if (!/^[a-f0-9]{12}$/.test(jobId)) {
      return Response.json({ error: { code: 'VALIDATION', message: 'Invalid person analysis job ID' } }, { status: 400 })
    }
    return Response.json({ data: await getPersonAnalysisJobStatus(jobId) })
  } catch (error) {
    if (isUnsafePathError(error)) {
      return Response.json({ error: { code: 'VALIDATION', message: error.message } }, { status: 400 })
    }
    return Response.json({ error: { code: 'INTERNAL', message: String(error) } }, { status: 500 })
  }
}
