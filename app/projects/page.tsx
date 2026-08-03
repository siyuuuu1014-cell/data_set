'use client'

import { useState } from 'react'
import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import Link from 'next/link'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { PageHeader, PageShell, SlidingControl, useConfirm } from '@/components/ui'
import styles from './projects.module.css'

export default function ProjectsPage() {
  const { projects, getTables, deleteProject } = useStore()
  const { t, lang } = useLang()
  const confirmAction = useConfirm()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'recent'>('all')
  const [retryKey, setRetryKey] = useState(0)

  const summaryResult = (() => {
    try {
      return {
        error: null,
        data: projects.map(project => {
          const tables = getTables(project.id)
          return {
            project,
            tableCount: tables.length,
            rowCount: tables.reduce((sum, table) => sum + (table.rowCount ?? table.rows.length), 0),
          }
        }),
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : t('project.read_error'), data: [] }
    }
  })()

  const projectSummaries = summaryResult.data
  const totalTables = projectSummaries.reduce((sum, item) => sum + item.tableCount, 0)
  const totalRows = projectSummaries.reduce((sum, item) => sum + item.rowCount, 0)
  const normalizedQuery = query.trim().toLocaleLowerCase(lang === 'zh' ? 'zh-CN' : 'en-US')
  const filteredProjects = projectSummaries
    .filter(({ project }) => !normalizedQuery || project.name.toLocaleLowerCase(lang === 'zh' ? 'zh-CN' : 'en-US').includes(normalizedQuery))
    .sort((left, right) => filter === 'recent'
      ? Date.parse(right.project.createdAt) - Date.parse(left.project.createdAt)
      : 0)
    .slice(0, filter === 'recent' ? 5 : undefined)

  const resetFilters = () => {
    setQuery('')
    setFilter('all')
  }

  return (
    <div className="flex-1 flex flex-col">
      <WorkspaceHeader />

      <PageShell width="wide" className={styles.pageContent}>
        <PageHeader
          className={styles.pageHeader}
          title={t('project.list_title')}
          description={t('project.list_desc')}
          actions={(
            <Link href="/project/new" className={styles.primaryAction}>
              <span aria-hidden="true">+</span>
              {t('home.new_project')}
            </Link>
          )}
        />

        <dl className={styles.summaryStrip} aria-label={t('project.workspace_summary')}>
          <div><dt>{t('project.metric_projects')}</dt><dd>{projects.length}</dd></div>
          <div><dt>{t('project.metric_tables')}</dt><dd>{totalTables}</dd></div>
          <div><dt>{t('project.metric_rows')}</dt><dd>{totalRows.toLocaleString()}</dd></div>
        </dl>

        {projects.length > 0 && !summaryResult.error && (
          <section className={styles.directoryToolbar} aria-label={t('project.directory_tools')}>
            <label className={styles.searchField}>
              <span>{t('app.search')}</span>
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('project.search_placeholder')}
              />
            </label>
            <SlidingControl
              value={filter}
              options={(['all', 'recent'] as const).map(option => ({ value: option, label: t(`project.filter.${option}`) }))}
              onChange={setFilter}
              label={t('project.filter_label')}
              className={styles.filterSlider}
            />
          </section>
        )}

        {summaryResult.error ? (
          <section className={styles.readError} role="alert" key={retryKey}>
            <div>
              <strong>{t('project.read_error')}</strong>
              <p>{summaryResult.error}</p>
            </div>
            <button type="button" onClick={() => setRetryKey(value => value + 1)}>{t('state.retry')}</button>
          </section>
        ) : projects.length === 0 ? (
          <section className={styles.emptyState}>
            <h2>{t('home.no_projects')}</h2>
            <p>{t('home.no_projects_desc')}</p>
            <Link href="/project/new" className={styles.emptyAction}>{t('home.new_project')}</Link>
          </section>
        ) : filteredProjects.length === 0 ? (
          <section className={styles.noResults} aria-live="polite">
            <strong>{t('project.no_results')}</strong>
            <p>{t('project.no_results_help')}</p>
            <button type="button" onClick={resetFilters}>{t('project.reset_filters')}</button>
          </section>
        ) : (
          <section className={styles.projectDirectory} aria-label={t('project.project_list')}>
            <header>
              <span>{t('project.directory_project')}</span>
              <span>{t('project.directory_scale')}</span>
              <span>{t('project.directory_created')}</span>
              <span>{t('project.directory_actions')}</span>
            </header>
            {filteredProjects.map(({ project, tableCount, rowCount }) => (
              <article key={project.id}>
                <div className={styles.projectIdentity}>
                  <span className={styles.projectMonogram} aria-hidden="true">{project.name.trim().slice(0, 1).toLocaleUpperCase()}</span>
                  <Link href={`/project/${project.id}`} className={styles.projectNameLink}>{project.name}</Link>
                </div>
                <div className={styles.projectScale}>
                  <strong>{tableCount} {t('project.metric_tables')}</strong>
                  <small>{rowCount.toLocaleString()} {t('project.metric_rows')}</small>
                </div>
                <time dateTime={project.createdAt}>
                  {new Date(project.createdAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </time>
                <div className={styles.projectActions}>
                  <Link href={`/project/${project.id}`} className={styles.openAction}>{t('project.open')}</Link>
                  <button
                    type="button"
                    onClick={async () => {
                      if (await confirmAction({ message: `${t('project.delete_project_confirm')} "${project.name}"?`, confirmLabel: t('app.delete'), tone: 'danger' })) {
                        deleteProject(project.id)
                      }
                    }}
                    className={styles.deleteAction}
                  >
                    {t('app.delete')}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </PageShell>
    </div>
  )
}
