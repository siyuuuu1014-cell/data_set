'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/services/i18n'
import { WorkspaceConfigStatus } from '@/components/WorkspaceConfigStatus'

export function WorkspaceHeader({ actions }: { actions?: React.ReactNode }) {
  const pathname = usePathname()
  const { t } = useLang()
  const videoActive = pathname.startsWith('/annotations') || pathname.includes('/annotate')

  const workspaces = [
    {
      label: t('workspace.synthetic'),
      description: t('workspace.synthetic_short'),
      href: '/',
      active: !videoActive,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      label: t('workspace.video'),
      description: t('workspace.video_short'),
      href: '/annotations',
      active: videoActive,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
    },
  ]

  return (
    <header className="border-b border-gv-border/50 bg-gv-bg/80 backdrop-blur-xl">
      <div className="px-4 sm:px-8 py-4 flex flex-wrap items-center gap-4">
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-gv-pink to-gv-green flex items-center justify-center shadow shadow-gv-pink/20">
            <span className="text-white font-bold text-xs">N</span>
          </div>
          <div className="leading-tight">
            <span className="gradient-text font-bold tracking-tight">{t('app.brand')}</span>
            <span className="hidden xl:inline text-xs text-gv-text-muted ml-2">{t('app.workspace_subtitle')}</span>
          </div>
        </Link>

        <nav className="order-3 sm:order-none w-full sm:w-auto sm:ml-4 flex items-center gap-1 rounded-xl border border-gv-border/70 bg-gv-surface/70 p-1" aria-label={t('workspace.nav_label')}>
          {workspaces.map(workspace => (
            <Link
              key={workspace.href}
              href={workspace.href}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                workspace.active
                  ? 'bg-gv-surface text-gv-text shadow-sm border border-gv-border/70'
                  : 'text-gv-text-dim hover:text-gv-text hover:bg-gv-bg'
              }`}
              title={workspace.description}
            >
              <span className={workspace.active ? 'text-gv-pink' : 'text-gv-text-muted'}>{workspace.icon}</span>
              {workspace.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <WorkspaceConfigStatus workspace={videoActive ? 'video' : 'synthetic'} />
          <Link href="/settings" className="text-sm text-gv-text-dim hover:text-gv-pink transition-colors">
            {t('app.settings')}
          </Link>
          {actions}
        </div>
      </div>
    </header>
  )
}
