'use client'

import Link from 'next/link'
import { useLang } from '@/services/i18n'
import styles from './status-pages.module.css'

export default function NotFound() {
  const { t } = useLang()

  return (
    <main className={styles.page} data-kind="not-found">
      <section className={styles.panel} aria-labelledby="not-found-title">
        <div className={styles.mark} aria-hidden="true">404</div>
        <h1 id="not-found-title" className={styles.title}>{t('state.not_found_title')}</h1>
        <p className={styles.description}>{t('state.not_found_desc')}</p>
        <div className={styles.actions}>
          <Link href="/" className={styles.primary}>{t('state.back_home')}</Link>
          <Link href="/projects" className={styles.secondary}>{t('state.open_projects')}</Link>
          <Link href="/annotations" className={styles.secondary}>{t('state.open_annotations')}</Link>
        </div>
      </section>
    </main>
  )
}
