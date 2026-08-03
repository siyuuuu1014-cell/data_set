'use client'

import Link from 'next/link'
import { useLang } from '@/services/i18n'
import styles from './status-pages.module.css'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLang()

  return (
    <main className={styles.page} data-kind="error">
      <section className={styles.panel} aria-labelledby="error-title">
        <div className={styles.mark} aria-hidden="true">!</div>
        <h1 id="error-title" className={styles.title}>{t('state.error_title')}</h1>
        <p className={styles.description}>{t('state.error_desc')}</p>
        <div className={styles.actions}>
          <button type="button" onClick={reset} className={styles.primary}>{t('state.retry')}</button>
          <Link href="/" className={styles.secondary}>{t('state.back_home')}</Link>
          <Link href="/projects" className={styles.secondary}>{t('state.open_projects')}</Link>
          <Link href="/annotations" className={styles.secondary}>{t('state.open_annotations')}</Link>
        </div>
      </section>
    </main>
  )
}
