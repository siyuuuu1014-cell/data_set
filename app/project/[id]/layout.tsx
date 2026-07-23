'use client'

import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>()
  const { projects } = useStore()
  const { t } = useLang()
  const pathname = usePathname()
  const project = projects.find(p => p.id === id)

  if (pathname.includes('/annotate')) return children

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gv-text-dim">{t('project.not_found')}</p>
          <Link href="/" className="text-sm text-gv-pink hover:underline mt-2 inline-block">
            {t('app.back')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <WorkspaceHeader />
      <div className="border-b border-gv-border/50 bg-gv-surface/50">
        <div className="max-w-5xl mx-auto w-full px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-gv-text-dim hover:text-gv-pink transition-colors flex-shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-gv-text-muted">{t('workspace.synthetic')}</p>
            <h1 className="text-lg font-semibold text-gv-text">{project.name}</h1>
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}
