'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/services/i18n'

type Workspace = 'synthetic' | 'video'
type Tone = 'ready' | 'warning' | 'error' | 'checking'

export function WorkspaceConfigStatus({ workspace }: { workspace: Workspace }) {
  const { t } = useLang()
  const [label, setLabel] = useState(t('status.checking'))
  const [tone, setTone] = useState<Tone>('checking')

  useEffect(() => {
    let active = true

    if (workspace === 'synthetic') {
      fetch('/api/llm/config')
        .then(response => response.json())
        .then(data => {
          if (!active) return
          setLabel(data.configured ? t('status.llm_configured') : t('status.llm_unconfigured'))
          setTone(data.configured ? 'ready' : 'warning')
        })
        .catch(() => {
          if (!active) return
          setLabel(t('status.config_unavailable'))
          setTone('error')
        })
    } else {
      fetch('/api/video-annotation/worker/health')
        .then(response => {
          if (!active) return
          setLabel(response.ok ? t('video.worker_ready') : t('video.worker_unavailable'))
          setTone(response.ok ? 'ready' : 'error')
        })
        .catch(() => {
          if (!active) return
          setLabel(t('video.worker_unavailable'))
          setTone('error')
        })
    }

    return () => { active = false }
  }, [t, workspace])

  const toneClasses: Record<Tone, { text: string; dot: string }> = {
    ready: {
      text: 'text-gv-green-deep hover:text-gv-green-dark',
      dot: 'bg-gv-green-deep ring-2 ring-gv-green-deep/10',
    },
    warning: {
      text: 'text-gv-gold hover:text-gv-pink',
      dot: 'bg-gv-gold ring-2 ring-gv-gold/10',
    },
    error: {
      text: 'text-gv-pink hover:text-gv-pink-light',
      dot: 'bg-gv-pink ring-2 ring-gv-pink/10',
    },
    checking: {
      text: 'text-gv-text-dim',
      dot: 'bg-gv-gold animate-pulse',
    },
  }

  return (
    <Link href="/settings" className={`hidden sm:flex items-center gap-2 text-xs transition-colors ${toneClasses[tone].text}`} aria-live="polite">
      <span className={`w-2 h-2 rounded-full ${toneClasses[tone].dot}`} />
      <span>{label}</span>
    </Link>
  )
}
