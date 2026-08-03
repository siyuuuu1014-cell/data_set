import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { AnnotateSet, VideoTaskItem } from '../../services/video-annotation/types'

/** DELETE /api/video-annotation/annotate-sets/[id] */
type DeleteRoute = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

/**
 * The route computes its data root at module load time from process.cwd() and
 * Node caches modules by URL, so all cases must share a single chdir + import.
 */
test('deleting an annotation set removes its uploads and identity cache without touching other sets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nuwa-set-delete-'))
  const previousCwd = process.cwd()
  process.chdir(root)
  try {
    const { mkdir: makeDir } = await import('node:fs/promises')
    const videoDataRoot = path.join('data', 'video-annotations')
    const taskA = path.join(videoDataRoot, 'tasks', 'set-abc')
    const taskB = path.join(videoDataRoot, 'tasks', 'set-other')
    const taskCorrupt = path.join(videoDataRoot, 'tasks', 'set-corrupt')
    const uploadsRoot = path.join(videoDataRoot, 'uploads')
    const cacheRoot = path.join(videoDataRoot, 'cache', 'video-identities')
    await makeDir(taskA, { recursive: true })
    await makeDir(taskB, { recursive: true })
    await makeDir(taskCorrupt, { recursive: true })
    await makeDir(path.join(uploadsRoot, 'video-1'), { recursive: true })
    await makeDir(path.join(uploadsRoot, 'video-2'), { recursive: true })
    await makeDir(path.join(uploadsRoot, 'video-other'), { recursive: true })
    await makeDir(cacheRoot, { recursive: true })

    const taskJson = (id: string, videos: Array<{ videoId: string; fileName: string }>): AnnotateSet => ({
      id,
      projectId: 'project-1',
      name: 'test set',
      status: 'draft',
      videos: videos.map(v => ({
        ...v,
        filePath: `uploads/${v.videoId}`,
        duration: 1,
        fps: 24,
        width: 640,
        height: 360,
        status: 'pending' as const,
        segments: [],
        uploadProgress: 100,
      })) as VideoTaskItem[],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await writeFile(path.join(taskA, 'task.json'), JSON.stringify(taskJson('set-abc', [
      { videoId: 'video-1', fileName: 'a.mp4' },
      { videoId: 'video-2', fileName: 'b.mp4' },
    ])))
    await writeFile(path.join(taskB, 'task.json'), JSON.stringify(taskJson('set-other', [
      { videoId: 'video-other', fileName: 'c.mp4' },
    ])))
    await writeFile(path.join(taskCorrupt, 'task.json'), '{ not valid json')
    await writeFile(path.join(uploadsRoot, 'video-1', 'source.mp4'), 'video-data')
    await writeFile(path.join(uploadsRoot, 'video-2', 'source.mp4'), 'more-video')
    await writeFile(path.join(uploadsRoot, 'video-other', 'source.mp4'), 'other-video')

    const mod = await import('../../app/api/video-annotation/annotate-sets/[id]/route')
    const del = mod.DELETE as DeleteRoute

    // Case 1: normal set with two videos
    const res = await del(new Request('http://localhost/api/video-annotation/annotate-sets/set-abc'), { params: Promise.resolve({ id: 'set-abc' }) })
    const body = await res.json() as { success?: boolean; cleanupPending?: boolean }
    assert.equal(res.status, 200)
    assert.equal(body.success, true)
    assert.equal(body.cleanupPending, false)

    assert.equal(existsSync(taskA), false, 'deleted set task directory must be removed')
    assert.equal(existsSync(path.join(uploadsRoot, 'video-1')), false, 'video-1 uploads must be removed')
    assert.equal(existsSync(path.join(uploadsRoot, 'video-2')), false, 'video-2 uploads must be removed')

    // Untouched set and its video are preserved
    assert.equal(existsSync(path.join(taskB, 'task.json')), true, 'other set task must survive')
    assert.equal(existsSync(path.join(uploadsRoot, 'video-other', 'source.mp4')), true, 'other video must survive')

    const remaining = await readdir(cacheRoot)
    assert.deepEqual(remaining, [], 'identity cache files must be removed')

    // Case 2: corrupt task file still gets its directory removed
    const resCorrupt = await del(new Request('http://localhost/api/video-annotation/annotate-sets/set-corrupt'), { params: Promise.resolve({ id: 'set-corrupt' }) })
    assert.equal(resCorrupt.status, 200)
    assert.equal(existsSync(taskCorrupt), false, 'corrupt-task set directory must be removed')

    // Case 3: nonexistent set is a no-op success
    const resMissing = await del(new Request('http://localhost/api/video-annotation/annotate-sets/set-missing'), { params: Promise.resolve({ id: 'set-missing' }) })
    assert.equal(resMissing.status, 200)
  } finally {
    process.chdir(previousCwd)
    // Windows can hold directory handles briefly after chdir — retry cleanup;
    // cleanup failure must not fail the test itself.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(root, { recursive: true, force: true })
        break
      } catch {
        if (attempt < 4) {
          await new Promise(resolve => setTimeout(resolve, 100))
        } else {
          console.error('[set-delete] temp cleanup failed:', root)
        }
      }
    }
  }
})
