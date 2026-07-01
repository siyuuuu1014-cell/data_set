'use client'

import { useStore } from '@/services/store'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useLang } from '@/services/i18n'
import Link from 'next/link'

export default function NewProjectPage() {
  const { addProject } = useStore()
  const { t } = useLang()
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('project.name_required'))
      return
    }
    const project = addProject(name.trim())
    router.push(`/project/${project.id}`)
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-gv-border/50">
        <div className="px-8 py-5 flex items-center gap-3">
          <Link href="/" className="text-gv-text-dim hover:text-gv-pink transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold text-gv-text">{t('project.new_title')}</h1>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gv-text mb-2">{t('project.name_placeholder')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
              placeholder={t('project.name_placeholder')}
              className="input-field w-full py-3 text-base"
              autoFocus
            />
            {error && <p className="text-sm text-gv-pink-dark mt-1">{error}</p>}
          </div>
          <button type="submit" className="btn-primary w-full rounded-lg px-4 py-3 text-sm">
            {t('project.create_btn')}
          </button>
        </form>
      </main>
    </div>
  )
}
