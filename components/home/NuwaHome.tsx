'use client'

import Image from 'next/image'
import Link from 'next/link'
import { LangToggle } from '@/components/LangToggle'
import { useLang } from '@/services/i18n'
import styles from './home.module.css'

const WORKSPACES = [
  {
    key: 'synthetic',
    labelKey: 'home.landing.synthetic_label',
    titleKey: 'home.landing.synthetic_title',
    descriptionKey: 'home.landing.synthetic_desc',
    actionKey: 'home.landing.synthetic_action',
    href: '/projects',
  },
  {
    key: 'annotation',
    labelKey: 'home.landing.annotation_label',
    titleKey: 'home.landing.annotation_title',
    descriptionKey: 'home.landing.annotation_desc',
    actionKey: 'home.landing.annotation_action',
    href: '/annotations',
  },
] as const

export function NuwaHome() {
  const { t } = useLang()

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#workspace-entry">{t('home.landing.skip')}</a>

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label={t('home.landing.home_aria')}>
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
          <span className={styles.brandCopy}>
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
        <nav className={styles.utilityNav} aria-label={t('home.landing.nav_aria')}>
          <LangToggle className={styles.languageToggle} />
          <Link href="/settings">{t('app.settings')}</Link>
        </nav>
      </header>

      <div className={styles.content}>
        <section className={styles.homeThesis} aria-labelledby="home-title">
          <div className={styles.homeIntroduction}>
            <div className={styles.homeStatement}>
              <h1 id="home-title">
                <span>{t('home.landing.title_line_1')}</span>
                <span>{t('home.landing.title_line_2')}</span>
              </h1>
              <p>{t('home.landing.description')}</p>
            </div>

            <nav
              className={styles.heroWorkspaces}
              id="workspace-entry"
              aria-label={t('home.landing.workspaces_aria')}
            >
              {WORKSPACES.map(workspace => (
                <Link className={styles.heroWorkspace} href={workspace.href} key={workspace.key}>
                  <span>{t(workspace.labelKey)}</span>
                  <strong>{t(workspace.titleKey)}</strong>
                  <small>{t(workspace.descriptionKey)}</small>
                  <b>{t(workspace.actionKey)}</b>
                </Link>
              ))}
            </nav>

            <div className={styles.pipelineProof} aria-label={t('home.landing.pipeline_aria')}>
              <div className={styles.pipelineInput}>
                <span>{t('home.landing.input')}</span>
                <strong>Schema</strong>
                <strong>Video</strong>
              </div>
              <div className={styles.pipelineCore}>
                <small>{t('home.landing.pipeline_core')}</small>
                <strong>{t('home.landing.generate')}</strong>
                <strong>{t('home.landing.recognize')}</strong>
                <strong>{t('home.landing.review')}</strong>
              </div>
              <div className={styles.pipelineOutput}>
                <span>{t('home.landing.output')}</span>
                <strong>Dataset</strong>
                <strong>Annotation</strong>
              </div>
            </div>
          </div>

          <div className={styles.brandStage} aria-hidden="true">
            <Image
              className={styles.heroBrandSymbol}
              src="/brand/nuwa-mark-drawn.svg"
              alt=""
              width={571}
              height={576}
              priority
            />
          </div>
        </section>
      </div>

      <Link className={styles.manualLink} href="/manual">
        {t('home.landing.manual')}
      </Link>
    </main>
  )
}
