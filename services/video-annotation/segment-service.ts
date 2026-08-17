/** Segment & video metadata services — server-side (API Route) helpers. */

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface VideoMetadataRaw {
  duration: number
  fps: number
  width: number
  height: number
}

/**
 * Get video metadata via ffprobe.
 * Called from API Routes (server-side only).
 */
export async function getVideoMetadata(filepath: string): Promise<VideoMetadataRaw> {
  const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe'

  try {
    const { stdout } = await execFileAsync(FFPROBE_PATH, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format', '-show_streams',
      filepath,
    ], { timeout: 30000 })

    const data = JSON.parse(stdout)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON parsing from ffprobe output
    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video')
    if (!videoStream) {
      throw new Error('No video stream found')
    }

    // Parse fps
    const fpsStr = videoStream.avg_frame_rate || '0/1'
    const [num, den] = fpsStr.split('/')
    const fps = den && parseFloat(den) !== 0 ? parseFloat(num) / parseFloat(den) : 0

    return {
      duration: parseFloat(data.format?.duration || videoStream.duration || '0'),
      fps,
      width: parseInt(videoStream.width || '0', 10),
      height: parseInt(videoStream.height || '0', 10),
    }
  } catch (err: unknown) {
    throw new Error(`ffprobe failed: ${(err as Error).message}`)
  }
}
