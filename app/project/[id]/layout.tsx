'use client'

import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>()
  const { projects } = useStore()
  const { t } = useLang()
  const pathname = usePathname()
  const project = projects.find(p => p.id === id)

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

  const tabs = [
    { label: t('project.tables'), href: `/project/${id}` },
  ]

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-gv-border/50">
        <div className="px-8 py-5 flex items-center gap-3">
          <Link href="/" className="text-gv-text-dim hover:text-gv-pink transition-colors flex-shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold text-gv-text">{project.name}</h1>
          <nav className="flex gap-1 ml-4">
            {tabs.map(tab => {
              const isActive = pathname === tab.href
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                    isActive
                      ? 'text-gv-pink bg-gv-pink/10'
                      : 'text-gv-text-dim hover:text-gv-text hover:bg-gv-surface'
                  }`}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}
