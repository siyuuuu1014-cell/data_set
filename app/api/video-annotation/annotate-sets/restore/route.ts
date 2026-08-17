import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { getTaskPath, TASKS_ROOT } from '@/services/video-annotation/server-paths'

// GET /api/video-annotation/annotate-sets/restore
export async function GET() {
  try {
    if (!existsSync(TASKS_ROOT)) {
      return Response.json([])
    }

    const dirs = await readdir(TASKS_ROOT)
    const results: Array<{ projectId: string; projectName: string; set: unknown }> = []

    for (const dirName of dirs) {
      try {
        const taskPath = getTaskPath(dirName)
        if (!existsSync(taskPath)) continue
        const raw = await readFile(taskPath, 'utf-8')
        const task = JSON.parse(raw)
        const setId = task.id || dirName
        const projectId = task.projectId || dirName.slice(0, 8)

        // Strip heavy payloads for localStorage
        const stripped = {
          id: setId,
          projectId,
          name: task.name || 'Recovered Set',
          status: 'draft' as const,
          videos: (task.videos || []).map((v: Record<string, unknown>) => ({
            ...v,
            segments: [],  // will be re-fetched from API
            uploadProgress: 0,
          })),
          createdAt: task.createdAt || new Date().toISOString(),
          updatedAt: task.updatedAt || new Date().toISOString(),
        }

        results.push({
          projectId,
          projectName: `Project ${projectId}`,
          set: stripped,
        })
      } catch {
        // skip corrupted task files
      }
    }

    return Response.json(results)
  } catch {
    return Response.json([])
  }
}
