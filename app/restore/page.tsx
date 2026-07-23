'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RestorePage() {
  const router = useRouter()

  useEffect(() => {
    const raw = localStorage.getItem('nuwa-store')
    const data = raw ? JSON.parse(raw) : { projects: [], tables: {}, annotateSets: {} }

    // ── Restore synthetic data project ──────────────
    if (!data.projects.find((p: { id: string }) => p.id === 'mr1h21v5')) {
      data.projects.push({
        id: 'mr1h21v5',
        name: 'clickhouse',
        createdAt: new Date('2025-07-01').toISOString(),
      })
    }
    const tableNames = [
      'content_feature', 'content_feature2', 'published_asset',
      'published_commerce', 'published_prompt', 'test',
      'u2a_behavior', 'u2c_behavior', 'u2p_behavior',
      'u2u_behavior', 'user_profile_features',
    ]
    const existing = data.tables['mr1h21v5'] || []
    for (const name of tableNames) {
      if (!existing.find((t: { name: string }) => t.name === name)) {
        existing.push({ id: name + '_' + Date.now(), name, columns: [], rows: [], rowCount: 0 })
      }
    }
    data.tables['mr1h21v5'] = existing

    // ── Scan & restore video annotation tasks ───────
    fetch('/api/video-annotation/annotate-sets/restore')
      .then(r => r.json())
      .then((tasks: Array<{ projectId: string; projectName: string; set: unknown }>) => {
        for (const task of tasks) {
          // Ensure project exists
          if (!data.projects.find((p: { id: string }) => p.id === task.projectId)) {
            data.projects.push({
              id: task.projectId,
              name: task.projectName,
              createdAt: new Date().toISOString(),
            })
          }
          // Ensure annotate set
          const sets = data.annotateSets[task.projectId] || []
          if (!sets.find((s: { id: string }) => s.id === (task.set as { id: string }).id)) {
            sets.push(task.set)
          }
          data.annotateSets[task.projectId] = sets
        }
        localStorage.setItem('nuwa-store', JSON.stringify(data))
        setTimeout(() => router.push('/'), 500)
      })
      .catch(() => {
        localStorage.setItem('nuwa-store', JSON.stringify(data))
        setTimeout(() => router.push('/'), 500)
      })
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-gv-text-dim">Restoring project data... redirecting...</p>
    </div>
  )
}
