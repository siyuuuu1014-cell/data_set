import { createHash } from 'node:crypto'
import path from 'path'
import { assertSafeIdentifier, resolveWithin } from '@/services/server-paths'

export const VIDEO_DATA_ROOT = path.join(process.cwd(), 'data', 'video-annotations')
export const TASKS_ROOT = resolveWithin(VIDEO_DATA_ROOT, 'tasks')
export const UPLOADS_ROOT = resolveWithin(VIDEO_DATA_ROOT, 'uploads')
export const CACHE_ROOT = resolveWithin(VIDEO_DATA_ROOT, 'cache')

export function getTaskDir(annotateSetId: string): string {
  assertSafeIdentifier(annotateSetId, 'annotation set ID')
  return resolveWithin(TASKS_ROOT, annotateSetId)
}

export function getTaskPath(annotateSetId: string): string {
  return resolveWithin(getTaskDir(annotateSetId), 'task.json')
}

export function getUploadDir(videoId: string): string {
  assertSafeIdentifier(videoId, 'video ID')
  return resolveWithin(UPLOADS_ROOT, videoId)
}

export function getUploadFile(videoId: string, fileName: string): string {
  assertSafeIdentifier(videoId, 'video ID')
  if (!/^source\.[A-Za-z0-9]+$/.test(fileName)) {
    throw new Error('Invalid uploaded video file name')
  }
  return resolveWithin(getUploadDir(videoId), fileName)
}

export function getVideoIdentityCachePath(videoId: string): string {
  assertSafeIdentifier(videoId, 'video ID')
  const key = createHash('sha256').update(videoId, 'utf8').digest('hex').slice(0, 24)
  return resolveWithin(CACHE_ROOT, 'video-identities', `${key}.json`)
}
