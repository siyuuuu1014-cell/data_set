import path from 'path'
import { assertSafeIdentifier, resolveWithin } from '@/services/server-paths'

export const VIDEO_DATA_ROOT = path.join(process.cwd(), 'data', 'video-annotations')
export const TASKS_ROOT = resolveWithin(VIDEO_DATA_ROOT, 'tasks')
export const UPLOADS_ROOT = resolveWithin(VIDEO_DATA_ROOT, 'uploads')

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
