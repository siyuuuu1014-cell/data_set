'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { useLang } from '@/services/i18n'
import styles from './restore.module.css'

type RestorePhase = 'scanning' | 'complete' | 'fallback'

export default function RestorePage() {
  const router = useRouter()
  const { t } = useLang()
  const [phase, setPhase] = useState<RestorePhase>('scanning')

  useEffect(() => {
    const raw = localStorage.getItem('nuwa-store')
    const data = raw ? JSON.parse(raw) : { projects: [], tables: {}, annotateSets: {} }

    // Restore synthetic data project.
    if (!data.projects.find((project: { id: string }) => project.id === 'mr1h21v5')) {
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
      if (!existing.find((table: { name: string }) => table.name === name)) {
        existing.push({ id: name + '_' + Date.now(), name, columns: [], rows: [], rowCount: 0 })
      }
    }
    data.tables['mr1h21v5'] = existing

    // Scan and restore video annotation tasks.
    fetch('/api/video-annotation/annotate-sets/restore')
      .then(response => response.json())
      .then((tasks: Array<{ projectId: string; projectName: string; set: unknown }>) => {
        for (const task of tasks) {
          if (!data.projects.find((project: { id: string }) => project.id === task.projectId)) {
            data.projects.push({
              id: task.projectId,
              name: task.projectName,
              createdAt: new Date().toISOString(),
            })
          }
          const sets = data.annotateSets[task.projectId] || []
          if (!sets.find((set: { id: string }) => set.id === (task.set as { id: string }).id)) {
            sets.push(task.set)
          }
          data.annotateSets[task.projectId] = sets
        }
        setPhase('complete')
        localStorage.setItem('nuwa-store', JSON.stringify(data))
        setTimeout(() => router.push('/projects'), 500)
      })
      .catch(() => {
        setPhase('fallback')
        localStorage.setItem('nuwa-store', JSON.stringify(data))
        setTimeout(() => router.push('/projects'), 500)
      })
  }, [router])

  const scanComplete = phase === 'complete' || phase === 'fallback'

  return (
    <div className={styles.page}>
      <WorkspaceHeader />
      <main className={styles.main} aria-busy={phase !== 'complete' && phase !== 'fallback'}>
        <section className={styles.panel} aria-labelledby="restore-title">
          <div className={styles.statusIcon} aria-hidden="true">
            <span className={styles.spinner} />
          </div>
          <h1 id="restore-title" className={styles.title}>{t('restore.title')}</h1>
          <p className={styles.description}>{t('restore.description')}</p>

          <div className={styles.steps} role="status" aria-live="polite">
            <div className={`${styles.step} ${styles.stepDone}`}>
              <span className={styles.stepDot}>✓</span>
              <span>{t('restore.local_data')}</span>
            </div>
            <div className={`${styles.step} ${scanComplete ? styles.stepDone : styles.stepActive}`}>
              <span className={styles.stepDot}>{scanComplete ? '✓' : '2'}</span>
              <span>{t('restore.video_tasks')}</span>
            </div>
            <div className={`${styles.step} ${scanComplete ? styles.stepActive : ''}`}>
              <span className={styles.stepDot}>3</span>
              <span>{t('restore.redirect')}</span>
            </div>
          </div>

          {phase === 'fallback' && (
            <p className={styles.fallback} role="status">{t('restore.fallback')}</p>
          )}
        </section>
      </main>
    </div>
  )
}
