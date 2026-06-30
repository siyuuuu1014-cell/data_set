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
          <p className="text-lg text-gv-text-dim">项目不存在</p>
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
      <header className="glass border-b border-gv-border/50">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center gap-4 mb-4">
            <Link href="/" className="text-gv-text-dim hover:text-gv-pink transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-gv-text">{project.name}</h1>
          </div>
          <nav className="flex gap-1">
            {tabs.map(tab => {
              const isActive = pathname === tab.href
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 relative ${
                    isActive
                      ? 'text-gv-pink bg-gv-pink/10'
                      : 'text-gv-text-dim hover:text-gv-text hover:bg-gv-surface'
                  }`}
                >
                  {tab.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-gradient-to-r from-gv-pink to-gv-green" />
                  )}
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
