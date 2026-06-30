'use client'

import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import Link from 'next/link'
import { useState, useEffect } from 'react'

export default function Home() {
  const { projects, deleteProject } = useStore()
  const { t, lang } = useLang()
  const [llmConfigured, setLlmConfigured] = useState(false)

  useEffect(() => {
    fetch('/api/llm/config')
      .then(r => r.json())
      .then(data => setLlmConfigured(data.configured))
      .catch(() => {})
  }, [])

  return (
    <div className="flex-1 flex flex-col">
      <header className="glass border-b border-gv-border/50">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gv-pink to-gv-green flex items-center justify-center shadow-lg shadow-gv-pink/20">
              <span className="text-white font-bold text-base">N</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="gradient-text">{t('app.brand')}</span>
              <span className="text-gv-text-dim font-normal text-base ml-2 hidden sm:inline">{t('app.subtitle')}</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full animate-pulse ${llmConfigured ? 'bg-gv-green shadow-[0_0_6px_var(--color-gv-green-glow)]' : 'bg-gv-pink shadow-[0_0_6px_var(--color-gv-pink-glow)]'}`} />
              <Link
                href="/settings"
                className={`text-xs transition-colors ${llmConfigured ? 'text-gv-green hover:text-gv-green-light' : 'text-gv-pink hover:text-gv-pink-light'}`}
              >
                {llmConfigured ? `✓ ${t('app.configured')}` : t('app.unconfigured')}
              </Link>
            </div>
            <Link
              href="/project/new"
              className="btn-primary rounded-lg px-4 py-2 text-sm"
            >
              + {t('home.new_project')}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gv-text">{t('home.title')}</h2>
          <p className="text-gv-text-dim text-sm mt-1">
            {projects.length > 0
              ? `${projects.length} 个项目`
              : t('home.no_projects_desc')}
          </p>
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
                      if (confirm(`${t('project.delete_confirm')}"${project.name}"？`)) {
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
