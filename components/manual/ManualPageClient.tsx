'use client'

import { useEffect, useMemo } from 'react'
import Link from 'next/link'
import { LangToggle } from '@/components/LangToggle'
import { useLang } from '@/services/i18n'
import {
  extractManualSections,
  MarkdownManual,
  withoutEmbeddedTableOfContents,
} from './MarkdownManual'
import { ManualToc } from './ManualToc'
import styles from '@/app/manual/manual.module.css'

type ManualPageClientProps = {
  zhSource: string
  enSource: string
}

const LABELS = {
  zh: {
    navigation: '手册导航',
    projects: '数据合成',
    annotations: '视频标注',
    settings: '设置',
    contents: '目录',
    contentsHint: '按章节阅读用户手册',
    contentsAria: '用户手册目录',
  },
  en: {
    navigation: 'Manual navigation',
    projects: 'Data synthesis',
    annotations: 'Video annotation',
    settings: 'Settings',
    contents: 'Contents',
    contentsHint: 'Read the guide by section',
    contentsAria: 'User manual contents',
  },
} as const

export function ManualPageClient({ zhSource, enSource }: ManualPageClientProps) {
  const { lang } = useLang()
  const labels = LABELS[lang]
  const source = lang === 'zh' ? zhSource : enSource
  const sections = useMemo(() => extractManualSections(source), [source])
  const articleSource = useMemo(() => withoutEmbeddedTableOfContents(source), [source])

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/">NUWA</Link>
        <div className={styles.headerActions}>
          <nav aria-label={labels.navigation}>
            <Link href="/projects">{labels.projects}</Link>
            <Link href="/annotations">{labels.annotations}</Link>
            <Link href="/settings">{labels.settings}</Link>
          </nav>
          <LangToggle className={styles.languageToggle} />
        </div>
      </header>
      <div className={styles.manualLayout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeading}>
            <strong>{labels.contents}</strong>
            <span>{labels.contentsHint}</span>
          </div>
          <ManualToc
            key={lang}
            sections={sections}
            ariaLabel={labels.contentsAria}
            className={styles.toc}
            linkClassName={styles.tocLink}
            activeLinkClassName={styles.tocLinkActive}
          />
        </aside>
        <article className={styles.article} lang={lang === 'zh' ? 'zh-CN' : 'en'}>
          <MarkdownManual key={lang} source={articleSource} />
        </article>
      </div>
    </main>
  )
}
