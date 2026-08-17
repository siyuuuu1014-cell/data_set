'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/services/i18n'
import { WorkspaceConfigStatus } from '@/components/WorkspaceConfigStatus'
import styles from './WorkspaceHeader.module.css'

export function WorkspaceHeader({ actions }: { actions?: React.ReactNode }) {
  const pathname = usePathname()
  const { t } = useLang()
  const videoActive = pathname.startsWith('/annotations') || pathname.includes('/annotate')
  const syntheticActive = pathname === '/projects' || pathname.startsWith('/project/')

  const workspaces = [
    {
      key: 'synthetic',
      label: t('workspace.synthetic'),
      description: t('workspace.synthetic_short'),
      href: '/projects',
      active: syntheticActive,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      key: 'video',
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
    <header className="border-b border-gv-border/60 bg-gv-surface/95">
      <div className={styles.headerInner}>
        <Link href="/" className={styles.brand} aria-label="NUWA 首页">
          <span className={styles.brandMark} aria-hidden="true">
            <Image
              className={styles.brandSymbol}
              src="/brand/nuwa-mark.svg"
              alt=""
              width={571}
              height={576}
              priority
            />
          </span>
          <span className={styles.brandCopy} aria-hidden="true">
            <Image
              className={styles.brandWordmark}
              src="/brand/nuwa-wordmark.svg"
              alt=""
              width={476}
              height={90}
              priority
            />
            <small>{t('app.workspace_subtitle')}</small>
          </span>
        </Link>

        <nav
          className={styles.workspaceNav}
          data-active={videoActive ? 'video' : 'synthetic'}
          aria-label={t('workspace.nav_label')}
        >
          {workspaces.map(workspace => (
            <Link
              key={workspace.key}
              href={workspace.href}
              aria-current={workspace.active ? 'page' : undefined}
              className={styles.workspaceLink}
              data-workspace={workspace.key}
              data-active={workspace.active ? 'true' : 'false'}
              title={workspace.description}
            >
              <span className={styles.workspaceIcon}>{workspace.icon}</span>
              {workspace.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
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
