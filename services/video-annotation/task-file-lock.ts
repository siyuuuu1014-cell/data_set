/** In-process serialization for annotation task-file read/modify/write cycles. */

import { writeFile, rename } from 'fs/promises'
import { unlink } from 'fs/promises'

type TaskLockGlobals = typeof globalThis & {
  __nuwaTaskFileLocks?: Map<string, Promise<void>>
}

const taskLockGlobals = globalThis as TaskLockGlobals
const taskFileLocks = taskLockGlobals.__nuwaTaskFileLocks ?? new Map<string, Promise<void>>()
taskLockGlobals.__nuwaTaskFileLocks = taskFileLocks

export async function withTaskFileLock<T>(taskPath: string, action: () => Promise<T>): Promise<T> {
  const previous = taskFileLocks.get(taskPath) ?? Promise.resolve()
  let releaseCurrent!: () => void
  const current = new Promise<void>(resolve => { releaseCurrent = resolve })
  const queued = previous.then(() => current)
  taskFileLocks.set(taskPath, queued)

  await previous
  try {
    return await action()
  } finally {
    releaseCurrent()
    if (taskFileLocks.get(taskPath) === queued) taskFileLocks.delete(taskPath)
  }
}

/** Atomically write a task file: write to a temp sibling, then rename into place. */
export async function writeTaskFileAtomic(taskPath: string, contents: string): Promise<void> {
  const tmpPath = `${taskPath}.tmp`
  await writeFile(tmpPath, contents)
  try {
    await rename(tmpPath, taskPath)
  } catch (err) {
    try { await unlink(tmpPath) } catch {}
    throw err
  }
}
