'use client'

import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import Link from 'next/link'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'

export default function Home() {
  const { projects, deleteProject } = useStore()
  const { t, lang } = useLang()
  return (
    <div className="flex-1 flex flex-col">
      <WorkspaceHeader />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-[0.18em] text-gv-pink font-semibold">{t('workspace.synthetic')}</span>
            <span className="h-px flex-1 bg-gv-border/70" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gv-text">{t('home.title')}</h2>
              <p className="text-gv-text-dim text-sm mt-1">
                {projects.length > 0
                  ? t('app.projects_count', projects.length)
                  : t('home.no_projects_desc')}
              </p>
            </div>
            <Link href="/project/new" className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center justify-center flex-shrink-0">
              + {t('home.new_project')}
            </Link>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 text-gv-text-dim">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-gv-pink/10 to-gv-green/10 flex items-center justify-center mb-5 border border-gv-border">
              <svg className="w-10 h-10 text-gv-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <p className="text-lg font-medium">{t('home.no_projects')}</p>
            <p className="text-sm mt-1">{t('home.no_projects_desc')}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, i) => (
              <div
                key={project.id}
                className="card group p-5 hover:border-gv-pink/40 hover:-translate-y-1 transition-all duration-300"
                style={{ animation: `fade-in 0.4s ease-out ${i * 0.05}s both` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gv-pink/20 to-gv-green/20 flex items-center justify-center border border-gv-border/50">
                    <svg className="w-5 h-5 text-gv-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`${t('project.delete_confirm')} "${project.name}"?`)) {
                        deleteProject(project.id)
                      }
                    }}
                    className="text-gv-text-muted hover:text-gv-pink transition-colors p-1 opacity-0 group-hover:opacity-100"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                <Link href={`/project/${project.id}`} className="block">
                  <h2 className="font-semibold text-gv-text group-hover:text-gv-pink transition-colors">
                    {project.name}
                  </h2>
                  <p className="text-xs text-gv-text-dim mt-1.5">
                    {new Date(project.createdAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </p>
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
