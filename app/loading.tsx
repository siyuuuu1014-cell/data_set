'use client'

import { useLang } from '@/services/i18n'
import styles from './status-pages.module.css'

export default function Loading() {
  const { t } = useLang()

  return (
    <main className={styles.page} data-kind="loading" aria-busy="true">
      <section className={styles.panel} aria-labelledby="loading-title">
        <div className={styles.mark} aria-hidden="true">
          <span className={styles.spinner} />
        </div>
        <h1 id="loading-title" className={styles.title}>{t('state.loading_title')}</h1>
        <p className={styles.description}>{t('state.loading_desc')}</p>
      </section>
    </main>
  )
}
