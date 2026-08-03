import type { Metadata } from 'next'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Link from 'next/link'
import {
  extractManualSections,
  MarkdownManual,
  withoutEmbeddedTableOfContents,
} from '@/components/manual/MarkdownManual'
import { ManualToc } from '@/components/manual/ManualToc'
import styles from './manual.module.css'

export const metadata: Metadata = {
  title: '用户手册 · NUWA',
  description: 'NUWA 本地智能数据工作台用户手册',
}

export default async function ManualPage() {
  const source = await readFile(path.join(process.cwd(), '用户手册.md'), 'utf8')
  const sections = extractManualSections(source)
  const articleSource = withoutEmbeddedTableOfContents(source)

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/">NUWA</Link>
        <nav aria-label="手册导航">
          <Link href="/projects">数据合成</Link>
          <Link href="/annotations">视频标注</Link>
          <Link href="/settings">设置</Link>
        </nav>
      </header>
      <div className={styles.manualLayout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeading}>
            <strong>目录</strong>
            <span>按章节阅读用户手册</span>
          </div>
          <ManualToc
            sections={sections}
            className={styles.toc}
            linkClassName={styles.tocLink}
            activeLinkClassName={styles.tocLinkActive}
          />
        </aside>
        <article className={styles.article}>
          <MarkdownManual source={articleSource} />
        </article>
      </div>
    </main>
  )
}
