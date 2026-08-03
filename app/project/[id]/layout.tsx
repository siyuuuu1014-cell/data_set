'use client'

import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { EmptyState, PageShell } from '@/components/ui'
import styles from '../project-management.module.css'

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>()
  const { projects, hydrated } = useStore()
  const { t } = useLang()
  const pathname = usePathname()
  const project = projects.find(p => p.id === id)

  if (pathname.includes('/annotate')) return children

  if (!hydrated) {
    return (
      <div className={styles.notFoundShell}>
        <WorkspaceHeader />
        <PageShell width="full" className={styles.notFound}>
          <p className={styles.projectLoading} role="status" aria-live="polite">{t('app.loading')}</p>
        </PageShell>
      </div>
    )
  }

  if (!project) {
    return (
      <div className={styles.notFoundShell}>
        <WorkspaceHeader />
        <div className={styles.projectContextBar}>
          <div className={styles.projectContext}>
            <Link href="/projects" className={styles.contextBack} aria-label={t('app.back')}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className={styles.projectMeta}>
              <p className={styles.projectType}>{t('workspace.synthetic')}</p>
              <h1 className={styles.projectName}>{t('project.not_found')}</h1>
            </div>
          </div>
        </div>
        <PageShell width="full" className={styles.notFound}>
          <EmptyState
            title={t('project.not_found')}
            description={t('project.not_found_desc')}
            action={<Link href="/projects" className={styles.backTextLink}>{t('app.back')}</Link>}
          />
        </PageShell>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <WorkspaceHeader />
      <div className={styles.projectContextBar}>
        <div className={styles.projectContext}>
          <Link href="/projects" className={styles.contextBack} aria-label={t('app.back')}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className={styles.projectMeta}>
            <p className={styles.projectType}>{t('workspace.synthetic')}</p>
            <h1 className={styles.projectName}>{project.name}</h1>
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}
