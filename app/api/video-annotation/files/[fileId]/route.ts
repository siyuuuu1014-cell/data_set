import { NextRequest } from 'next/server'
import { readdir, stat as statAsync } from 'fs/promises'
import { existsSync, createReadStream } from 'fs'
import path from 'path'
import { isUnsafePathError, resolveWithin } from '@/services/server-paths'
import { getUploadDir, getUploadFile } from '@/services/video-annotation/server-paths'

export const runtime = 'nodejs'

// GET /api/video-annotation/files/[fileId] — serve video with Range support, or extract frame
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params

  let videoDir: string
  try {
    videoDir = getUploadDir(fileId)
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'INVALID_PATH', message: err.message } }, { status: 400 })
    throw err
  }
  if (!existsSync(videoDir)) {
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Video not found' } }, { status: 404 })
  }

  const files = await readdir(videoDir)
  const videoFile = files.find((f: string) => f.startsWith('source.'))
  if (!videoFile) {
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Video file not found' } }, { status: 404 })
  }

  const filePath = getUploadFile(fileId, videoFile)

  // ── Frame extraction mode ──────────────────────────
  const url = new URL(req.url)
  const frameTime = url.searchParams.get('t')
  const frameIndex = url.searchParams.get('frame')
  const requestedFps = Number(url.searchParams.get('fps'))
  if (frameTime !== null || frameIndex !== null) {
    const parsedFrameIndex = frameIndex === null ? null : Number.parseInt(frameIndex, 10)
    const parsedTime = frameTime !== null
      ? Number(frameTime)
      : (parsedFrameIndex ?? 0) / requestedFps
    if (
      !Number.isFinite(parsedTime) || parsedTime < 0
      || (frameIndex !== null && (!Number.isInteger(parsedFrameIndex) || parsedFrameIndex! < 0))
      || (frameTime === null && (!Number.isFinite(requestedFps) || requestedFps <= 0))
    ) {
      return Response.json({ error: { code: 'VALIDATION', message: 'Invalid frame position' } }, { status: 400 })
    }
    const cacheKey = parsedFrameIndex === null
      ? `t_${Math.round(parsedTime * 1000)}`
      : `i_${parsedFrameIndex}_t_${Math.round(parsedTime * 1000)}`
    return extractFrame(filePath, parsedTime, videoDir, cacheKey)
  }

  // ── Video serving mode ─────────────────────────────
  const fileStat = await statAsync(filePath)
  const fileSize = fileStat.size

  const ext = path.extname(videoFile).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
  }
  const contentType = mimeTypes[ext] || 'video/mp4'

  // Handle Range requests
  const range = req.headers.get('range')
  if (range) {
    const [startStr, endStr] = range.replace('bytes=', '').split('-')
    const start = parseInt(startStr, 10)
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1

    if (start >= fileSize) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } })
    }

    const chunkSize = end - start + 1
    const stream = createReadStream(filePath, { start, end })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node.js ReadStream is accepted at runtime
    return new Response(stream as any, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
      },
    })
  }

  // Full file
  const stream2 = createReadStream(filePath)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node.js ReadStream is accepted at runtime
  return new Response(stream2 as any, {
    status: 200,
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    },
  })
}

// ── Frame extraction ────────────────────────────────

async function extractFrame(videoPath: string, timeSec: number, cacheDir: string, cacheKey: string): Promise<Response> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)

  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
  // Millisecond/frame-index keys avoid the old 0.1-second collision where
  // multiple neighbouring frames returned the same cached JPEG.
  const framePath = resolveWithin(cacheDir, `frame_${cacheKey}.jpg`)

  // Extract frame if not cached
  if (!existsSync(framePath)) {
    try {
      await execFileAsync(ffmpegPath, [
        '-ss', String(timeSec),
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '3',
        framePath,
        '-y',
      ], { timeout: 15000 })
    } catch {
      return new Response(
        Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'),
        { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' } }
      )
    }
  }

  const { readFile } = await import('fs/promises')
  const data = await readFile(framePath)

  return new Response(data, {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' },
  })
}
