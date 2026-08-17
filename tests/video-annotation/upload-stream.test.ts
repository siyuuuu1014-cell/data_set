import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  persistUploadStream,
  receiveMultipartVideoUpload,
  repairLegacyMultipartFilename,
  UploadStreamError,
} from '../../services/video-annotation/upload-stream'

const ALLOWED_EXTENSIONS = ['.mp4', '.mov']

function multipartRequest(fileName: string, content: Uint8Array): Request {
  const arrayBuffer = new ArrayBuffer(content.byteLength)
  new Uint8Array(arrayBuffer).set(content)
  const form = new FormData()
  form.set('file', new File([arrayBuffer], fileName, { type: 'video/mp4' }))
  return new Request('http://localhost/api/video-annotation/upload', {
    method: 'POST',
    body: form,
  })
}

test('multipart upload streams to disk and computes SHA-256', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nuwa-upload-test-'))
  const directory = path.join(root, 'video-1')
  const content = new TextEncoder().encode('small-video-content')

  try {
    const result = await receiveMultipartVideoUpload(
      multipartRequest('clip.mp4', content),
      {
        directory,
        maxFileSize: 1024,
        allowedExtensions: ALLOWED_EXTENSIONS,
      },
    )

    assert.equal(result.fileName, 'clip.mp4')
    assert.equal(result.size, content.byteLength)
    assert.equal(
      result.sha256,
      createHash('sha256').update(content).digest('hex'),
    )
    assert.deepEqual(await readFile(result.finalPath), Buffer.from(content))
    assert.deepEqual(await readdir(directory), ['source.mp4'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('multipart upload preserves a UTF-8 Chinese filename', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nuwa-upload-test-'))
  const directory = path.join(root, 'video-unicode')

  try {
    const result = await receiveMultipartVideoUpload(
      multipartRequest('中文测试视频.mp4', new Uint8Array([1, 2, 3])),
      {
        directory,
        maxFileSize: 1024,
        allowedExtensions: ALLOWED_EXTENSIONS,
      },
    )

    assert.equal(result.fileName, '中文测试视频.mp4')
    assert.deepEqual(await readdir(directory), ['source.mp4'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy UTF-8-as-Latin-1 filenames are repaired conservatively', () => {
  const original = '快看！这里有野生人类_哔哩哔哩_bilibili.mp4'
  const mojibake = Buffer.from(original, 'utf8').toString('latin1')

  assert.equal(repairLegacyMultipartFilename(mojibake), original)
  assert.equal(repairLegacyMultipartFilename('clip.mp4'), 'clip.mp4')
  assert.equal(repairLegacyMultipartFilename('café.mp4'), 'café.mp4')
  assert.equal(repairLegacyMultipartFilename('合法中文.mp4'), '合法中文.mp4')
})

test('oversized uploads leave no temporary file or upload directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nuwa-upload-test-'))
  const directory = path.join(root, 'video-2')

  try {
    await assert.rejects(
      receiveMultipartVideoUpload(
        multipartRequest('large.mp4', new Uint8Array(6)),
        {
          directory,
          maxFileSize: 5,
          allowedExtensions: ALLOWED_EXTENSIONS,
          removeDirectoryOnFailure: true,
        },
      ),
      (error: unknown) => (
        error instanceof UploadStreamError
        && error.code === 'VIDEO_FILE_TOO_LARGE'
        && error.status === 413
      ),
    )
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a file exactly at the configured size limit is accepted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nuwa-upload-test-'))
  const directory = path.join(root, 'video-exact-limit')

  try {
    const result = await receiveMultipartVideoUpload(
      multipartRequest('exact.mp4', new Uint8Array(5)),
      {
        directory,
        maxFileSize: 5,
        allowedExtensions: ALLOWED_EXTENSIONS,
      },
    )
    assert.equal(result.size, 5)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unsupported extensions are rejected before writing a file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nuwa-upload-test-'))
  const directory = path.join(root, 'video-3')

  try {
    await assert.rejects(
      receiveMultipartVideoUpload(
        multipartRequest('notes.txt', new Uint8Array([1, 2, 3])),
        {
          directory,
          maxFileSize: 1024,
          allowedExtensions: ALLOWED_EXTENSIONS,
          removeDirectoryOnFailure: true,
        },
      ),
      (error: unknown) => (
        error instanceof UploadStreamError
        && error.code === 'VIDEO_FORMAT_UNSUPPORTED'
      ),
    )
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('malformed multipart requests return validation errors and clean up', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nuwa-upload-test-'))
  const directory = path.join(root, 'video-malformed')
  const request = new Request('http://localhost/api/video-annotation/upload', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data' },
    body: 'missing boundary',
  })

  try {
    await assert.rejects(
      receiveMultipartVideoUpload(request, {
        directory,
        maxFileSize: 1024,
        allowedExtensions: ALLOWED_EXTENSIONS,
        removeDirectoryOnFailure: true,
      }),
      (error: unknown) => (
        error instanceof UploadStreamError
        && error.code === 'VALIDATION'
        && error.status === 400
      ),
    )
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an existing upload directory is never reused or removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nuwa-upload-test-'))
  const directory = path.join(root, 'existing-video')
  const markerPath = path.join(directory, 'existing.txt')
  await mkdir(directory)
  await writeFile(markerPath, 'keep')

  try {
    await assert.rejects(
      receiveMultipartVideoUpload(
        multipartRequest('clip.mp4', new Uint8Array([1, 2, 3])),
        {
          directory,
          maxFileSize: 1024,
          allowedExtensions: ALLOWED_EXTENSIONS,
          removeDirectoryOnFailure: true,
        },
      ),
    )
    assert.equal(await readFile(markerPath, 'utf8'), 'keep')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an interrupted input removes the partial temporary file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nuwa-upload-test-'))
  const temporaryPath = path.join(root, 'source.tmp')
  const interrupted = Readable.from((async function* () {
    yield Buffer.from('partial')
    throw new Error('client disconnected')
  })())

  try {
    await assert.rejects(
      persistUploadStream(interrupted, temporaryPath, 1024),
      /client disconnected/,
    )
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
