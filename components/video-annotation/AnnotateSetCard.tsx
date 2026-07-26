'use client'

import Link from 'next/link'
import { useLang } from '@/services/i18n'
import { deriveAnnotateSetStatus } from '@/services/video-annotation/status'
import type { AnnotateSet, AnnotateSetStatus } from '@/services/video-annotation/types'

const STATUS_STYLES: Record<AnnotateSetStatus, { labelKey: string; color: string }> = {
  draft: { labelKey: 'video.status.draft', color: 'bg-gv-text-muted' },
  uploading: { labelKey: 'video.status.uploading', color: 'bg-gv-gold' },
  splitting: { labelKey: 'video.status.splitting', color: 'bg-gv-gold' },
  awaiting_segment_review: { labelKey: 'video.status.segment_review', color: 'bg-gv-gold' },
  annotating: { labelKey: 'video.status.annotating', color: 'bg-gv-gold' },
  validating: { labelKey: 'video.status.validating', color: 'bg-gv-gold' },
  awaiting_review: { labelKey: 'video.status.review', color: 'bg-gv-pink' },
  approved: { labelKey: 'video.status.approved', color: 'bg-gv-green-deep' },
  completed: { labelKey: 'video.status.completed', color: 'bg-gv-green-deep' },
  partial_completed: { labelKey: 'video.status.partial_completed', color: 'bg-gv-gold' },
  failed: { labelKey: 'video.status.failed', color: 'bg-gv-pink-dark' },
  cancelled: { labelKey: 'video.status.cancelled', color: 'bg-gv-text-muted' },
}

interface Props {
  set: AnnotateSet
  index?: number
  onDelete: (id: string) => void
}

export function AnnotateSetCard({ set, index = 0, onDelete }: Props) {
  const { t, lang } = useLang()
  const stat = STATUS_STYLES[deriveAnnotateSetStatus(set)]
  const videoCount = set.videos?.length || 0
  const segmentCount = set.videos?.reduce((s, v) => s + (v.segments?.length || 0), 0) || 0

  return (
    <div
      className="card group p-5 hover:border-gv-pink/40 hover:-translate-y-1 transition-all duration-300"
      style={{ animation: `fade-in 0.4s ease-out ${index * 0.05}s both` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gv-pink/20 to-gv-green/20 flex items-center justify-center border border-gv-border/50">
          <svg className="w-5 h-5 text-gv-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <button
          onClick={() => {
            if (confirm(`${t('video.delete_project_confirm')} "${set.name}"?`)) onDelete(set.id)
          }}
          className="text-gv-text-muted hover:text-gv-pink transition-colors p-1 opacity-0 group-hover:opacity-100"
          aria-label={t('app.delete')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
      <Link href={`/annotations/${set.id}`} className="block">
        <h2 className="font-semibold text-gv-text group-hover:text-gv-pink transition-colors truncate">{set.name}</h2>
        <p className="text-sm text-gv-text-dim mt-1.5">
          {t('video.video_count', videoCount)} &middot; {t('video.segment_count', segmentCount)}
        </p>
        <div className="flex items-center gap-2 mt-3">
          <span className={`inline-block w-2 h-2 rounded-full ${stat.color}`} />
          <span className="text-xs text-gv-text-dim">{t(stat.labelKey)}</span>
          <span className="text-xs text-gv-text-muted ml-auto">
            {new Date(set.createdAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
              year: 'numeric', month: 'short', day: 'numeric',
            })}
          </span>
        </div>
      </Link>
    </div>
  )
}
