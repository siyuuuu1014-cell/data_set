import assert from 'node:assert/strict'
import test from 'node:test'

import type { AnnotateSet, SegmentState, VideoTaskItem } from '../../services/video-annotation/types'
import {
  removeVideoFromAnnotationSet,
  VideoRemovalError,
} from '../../services/video-annotation/status'

function video(videoId: string, segments: SegmentState[] = []): VideoTaskItem {
  return {
    videoId,
    fileName: `${videoId}.mp4`,
    filePath: `uploads/${videoId}`,
    duration: 1,
    fps: 24,
    width: 640,
    height: 360,
    status: 'pending',
    segments,
    uploadProgress: 100,
  }
}

function task(videos: VideoTaskItem[]): AnnotateSet {
  return {
    id: 'set-1',
    projectId: 'project-1',
    name: 'test',
    status: 'draft',
    videos,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  }
}

test('video deletion removes only the selected project video', () => {
  const original = task([video('video-1'), video('video-2')])

  const updated = removeVideoFromAnnotationSet(original, 'video-1')

  assert.deepEqual(updated.videos.map(item => item.videoId), ['video-2'])
  assert.deepEqual(original.videos.map(item => item.videoId), ['video-1', 'video-2'])
  assert.notEqual(updated.updatedAt, original.updatedAt)
})

test('video deletion rejects an active annotation job', () => {
  const processingSegment: SegmentState = {
    segmentId: 1,
    start: 0,
    end: 1,
    status: 'processing',
    modelAnnotation: null,
    humanAnnotation: null,
    workerJobId: 'job-1',
  }

  assert.throws(
    () => removeVideoFromAnnotationSet(task([video('video-1', [processingSegment])]), 'video-1'),
    (error: unknown) => (
      error instanceof VideoRemovalError
      && error.code === 'VIDEO_BUSY'
      && error.status === 409
    ),
  )
})

test('video deletion rejects a video outside the selected project', () => {
  assert.throws(
    () => removeVideoFromAnnotationSet(task([video('video-1')]), 'video-2'),
    (error: unknown) => (
      error instanceof VideoRemovalError
      && error.code === 'VIDEO_NOT_FOUND'
      && error.status === 404
    ),
  )
})
