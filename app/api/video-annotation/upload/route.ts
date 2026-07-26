import { NextRequest } from 'next/server'
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

    // Extract metadata via ffprobe
    let metadata = { duration: 0, fps: 0, width: 0, height: 0 }
    try {
      metadata = await getVideoMetadata(upload.finalPath)
    } catch {
      // Metadata extraction failed — video will still be uploaded, user can retry later
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
