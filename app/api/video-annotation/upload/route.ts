import { NextRequest } from 'next/server'
import { createWriteStream } from 'fs'
import { mkdir, rename } from 'fs/promises'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import path from 'path'
import { Readable } from 'stream'
import { getVideoMetadata } from '@/services/video-annotation/segment-service'
import { resolveWithin } from '@/services/server-paths'
import { getUploadDir, getUploadFile } from '@/services/video-annotation/server-paths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm']

// POST /api/video-annotation/upload
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return Response.json({ error: { code: 'VALIDATION', message: 'Expected multipart/form-data' } }, { status: 400 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return Response.json({ error: { code: 'VALIDATION', message: 'No file provided' } }, { status: 400 })
    }

    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return Response.json({ error: { code: 'VIDEO_FORMAT_UNSUPPORTED', message: `Unsupported format: ${ext}` } }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: { code: 'VIDEO_FILE_TOO_LARGE', message: `File exceeds 2GB limit` } }, { status: 400 })
    }

    const videoId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const videoDir = getUploadDir(videoId)
    await mkdir(videoDir, { recursive: true })

    const tmpPath = resolveWithin(videoDir, 'source.tmp')
    const finalPath = getUploadFile(videoId, 'source' + ext)

    // Stream write + SHA-256
    const hash = createHash('sha256')
    const writeStream = createWriteStream(tmpPath)
    const buffer = Buffer.from(await file.arrayBuffer())

    hash.update(buffer)
    await pipeline(Readable.from(buffer), writeStream)
    await rename(tmpPath, finalPath)

    // Extract metadata via ffprobe
    let metadata = { duration: 0, fps: 0, width: 0, height: 0 }
    try {
      metadata = await getVideoMetadata(finalPath)
    } catch {
      // Metadata extraction failed — video will still be uploaded, user can retry later
    }

    return Response.json({
      data: {
        videoId,
        fileName: file.name,
        sha256: hash.digest('hex'),
        size: file.size,
        duration: metadata.duration,
        fps: metadata.fps,
        width: metadata.width,
        height: metadata.height,
      },
    }, { status: 201 })
  } catch (err) {
    return Response.json({ error: { code: 'UPLOAD_FAILED', message: String(err) } }, { status: 500 })
  }
}
