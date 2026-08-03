import { NextRequest } from 'next/server'
import { readFile, mkdir, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import type { AnnotateSet } from '@/services/video-annotation/types'
import { withDerivedAnnotationStatuses } from '@/services/video-annotation/status'
import { assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'
import { getTaskDir, getTaskPath, TASKS_ROOT } from '@/services/video-annotation/server-paths'
import { writeTaskFileAtomic } from '@/services/video-annotation/task-file-lock'

async function listTasks(projectId: string): Promise<AnnotateSet[]> {
  if (!existsSync(TASKS_ROOT)) return []
  const entries = await readdir(TASKS_ROOT, { withFileTypes: true })
  const results: AnnotateSet[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const taskPath = getTaskPath(entry.name)
      if (existsSync(taskPath)) {
        const raw = await readFile(taskPath, 'utf-8')
        const task = JSON.parse(raw) as AnnotateSet
        if (!projectId || task.projectId === projectId) {
          results.push(withDerivedAnnotationStatuses(task))
        }
      }
    } catch { /* skip invalid directory names and corrupted files */ }
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// GET /api/video-annotation/annotate-sets?projectId=X
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') || ''
  try {
    if (projectId) assertSafeIdentifier(projectId, 'project ID')
    const tasks = await listTasks(projectId)
    return Response.json({ data: tasks })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}

// POST /api/video-annotation/annotate-sets
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { projectId: string; name: string }
    if (!body.name || !body.projectId) {
      return Response.json({ error: { code: 'VALIDATION', message: 'name and projectId required' } }, { status: 400 })
    }
    assertSafeIdentifier(body.projectId, 'project ID')

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const now = new Date().toISOString()
    const task: AnnotateSet = {
      id,
      projectId: body.projectId,
      name: body.name,
      status: 'draft',
      videos: [],
      createdAt: now,
      updatedAt: now,
    }

    const taskDir = getTaskDir(id)
    await mkdir(taskDir, { recursive: true })
    await writeTaskFileAtomic(getTaskPath(id), JSON.stringify(task, null, 2))

    return Response.json({ data: task }, { status: 201 })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: { code: 'VALIDATION', message: err.message } }, { status: 400 })
    return Response.json({ error: { code: 'INTERNAL', message: String(err) } }, { status: 500 })
  }
}
