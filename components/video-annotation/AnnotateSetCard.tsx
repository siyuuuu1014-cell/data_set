'use client'

import Link from 'next/link'
import { useLang } from '@/services/i18n'
import { useConfirm } from '@/components/ui'
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

const REVIEW_STATUSES = new Set<AnnotateSetStatus>([
  'awaiting_review',
  'awaiting_segment_review',
  'partial_completed',
  'failed',
  'cancelled',
])

interface Props {
  set: AnnotateSet
  index?: number
  onDelete: (id: string) => void | Promise<void>
  deleting?: boolean
}

export function AnnotateSetCard({ set, onDelete, deleting = false }: Props) {
  const { t, lang } = useLang()
  const confirmAction = useConfirm()
  const status = deriveAnnotateSetStatus(set)
  const stat = STATUS_STYLES[status]
  const videoCount = set.videos?.length || 0
  const segmentCount = set.videos?.reduce((s, v) => s + (v.segments?.length || 0), 0) || 0
  const requiresReview = REVIEW_STATUSES.has(status)

  return (
    <article
      className="annotation-set-card"
      data-status={status}
    >
      <Link href={`/annotations/${set.id}`} className="annotation-set-card__project">
        <span className="annotation-set-card__monogram" aria-hidden="true">{set.name.trim().slice(0, 1).toLocaleUpperCase()}</span>
        <span className="annotation-set-card__copy">
          <h3>{set.name}</h3>
          <span>{t('video.video_count', videoCount)}</span>
        </span>
      </Link>
      <div className="annotation-set-card__scope">
        <strong>{segmentCount.toLocaleString()}</strong>
        <span>{t('video.segments')}</span>
      </div>
      <span className="annotation-set-card__status" data-status={status}>{t(stat.labelKey)}</span>
      <time className="annotation-set-card__date" dateTime={set.createdAt}>
        {new Date(set.createdAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
        })}
      </time>
      <div className="annotation-set-card__actions">
        <Link href={`/annotations/${set.id}`} className="annotation-set-card__open">
          {requiresReview ? t('video.quality_review') : t('video.open_project')}
        </Link>
        <button
          type="button"
          onClick={async () => {
            if (await confirmAction({ message: `${t('video.delete_project_confirm')} "${set.name}"?`, confirmLabel: t('app.delete'), tone: 'danger' })) void onDelete(set.id)
          }}
          className="annotation-set-card__delete"
          aria-label={`${t('app.delete')} ${set.name}`}
          disabled={deleting}
          aria-busy={deleting || undefined}
        >
          {deleting ? t('app.loading') : t('app.delete')}
        </button>
      </div>
    </article>
  )
}
