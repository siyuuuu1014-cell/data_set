import { NextRequest } from 'next/server'
import { rm } from 'fs/promises'
import { getVideoMetadata } from '@/services/video-annotation/segment-service'
import { getUploadDir } from '@/services/video-annotation/server-paths'
import {
  receiveMultipartVideoUpload,
  UploadStreamError,
} from '@/services/video-annotation/upload-stream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm']

// POST /api/video-annotation/upload
export async function POST(req: NextRequest) {
  try {
    const videoId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const videoDir = getUploadDir(videoId)
    const upload = await receiveMultipartVideoUpload(req, {
      directory: videoDir,
      maxFileSize: MAX_FILE_SIZE,
      allowedExtensions: ALLOWED_EXTENSIONS,
      removeDirectoryOnFailure: true,
    })

    // Extract metadata via ffprobe. Metadata failure is fatal for this upload:
    // accepting a video with 0 duration/fps/width/height poisons the whole
    // annotation pipeline (collapsed frame indexes, NaN exports).
    let metadata
    try {
      metadata = await getVideoMetadata(upload.finalPath)
    } catch {
      await rm(videoDir, { recursive: true, force: true }).catch(() => {})
      return Response.json(
        { error: { code: 'VIDEO_METADATA_FAILED', message: 'Failed to read video metadata. The file may be corrupted or unsupported.' } },
        { status: 422 },
      )
    }

    return Response.json({
      data: {
        videoId,
        fileName: upload.fileName,
        sha256: upload.sha256,
        size: upload.size,
        duration: metadata.duration,
        fps: metadata.fps,
        width: metadata.width,
        height: metadata.height,
      },
    }, { status: 201 })
  } catch (err) {
    if (err instanceof UploadStreamError) {
      return Response.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status },
      )
    }
    return Response.json({ error: { code: 'UPLOAD_FAILED', message: String(err) } }, { status: 500 })
  }
}
