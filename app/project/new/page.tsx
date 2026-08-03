'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { Button, PageHeader, PageShell } from '@/components/ui'
import { useLang } from '@/services/i18n'
import { useStore } from '@/services/store'
import type { Project } from '@/services/types'
import styles from '../project-management.module.css'

export default function NewProjectPage() {
  const { addProject } = useStore()
  const { t } = useLang()
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdProject, setCreatedProject] = useState<Project | null>(null)

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || createdProject) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('project.name_required'))
      nameInputRef.current?.focus()
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const project = addProject(trimmedName)
      setCreatedProject(project)
    } catch {
      setError(t('project.create_error'))
      nameInputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <WorkspaceHeader />

      <PageShell width="wide" className={styles.projectCreatePage}>
        <Link href="/projects" className={styles.backLink}>
          <span aria-hidden="true">&larr;</span> {t('app.back')}
        </Link>
        <PageHeader className={styles.projectCreateHeading} title={t('project.new_title')} description={t('project.new_desc')} />

        {createdProject ? (
          <section className={styles.creationSuccess} aria-labelledby="project-created-title" aria-live="polite">
            <span className={styles.successMark} aria-hidden="true">&#10003;</span>
            <div>
              <h2 id="project-created-title">{t('project.created_title')}</h2>
              <p>{t('project.created_name', createdProject.name)}</p>
              <p className={styles.successHint}>{t('project.created_next')}</p>
            </div>
            <div className={styles.successActions}>
              <Link href={`/project/${createdProject.id}/table/new`} className={styles.primaryLink}>
                {t('project.continue_table')}
              </Link>
              <Link href={`/project/${createdProject.id}`} className={styles.secondaryLink}>
                {t('project.open_project')}
              </Link>
            </div>
          </section>
        ) : (
          <form onSubmit={handleSubmit} className={styles.formSurface} noValidate>
            <div className={styles.field}>
              <label htmlFor="project-name">{t('project.name_label')}</label>
              <input
                ref={nameInputRef}
                id="project-name"
                type="text"
                value={name}
                onChange={event => {
                  setName(event.target.value)
                  setError('')
                }}
                placeholder={t('project.name_placeholder')}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'project-name-error' : 'project-name-help'}
                disabled={submitting}
                autoComplete="off"
                autoFocus
              />
              {error
                ? <p id="project-name-error" className={styles.fieldError} role="alert">{error}</p>
                : <p id="project-name-help" className={styles.fieldHelp}>{t('project.name_help')}</p>}
            </div>
            <aside className={styles.formOutcome} aria-label={t('project.after_create')}>
              <strong>{t('project.after_create')}</strong>
              <span>{t('project.after_create_workspace')}</span>
              <span>{t('project.after_create_table')}</span>
            </aside>
            <div className={styles.formActions}>
              <Link href="/projects" className={styles.secondaryLink}>{t('app.cancel')}</Link>
              <Button type="submit" size="lg" loading={submitting}>
                {t('project.create_continue')}
              </Button>
            </div>
          </form>
        )}
      </PageShell>
    </div>
  )
}
