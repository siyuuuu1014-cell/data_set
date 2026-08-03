import { notFound } from 'next/navigation'
import { PreviewStage } from '@/components/ui-review/PreviewStage'
import { REVIEW_PAGE_MAP, type PreviewKey } from '@/components/ui-review/review-data'

export default async function UiReviewPreviewPage({
  params,
}: {
  params: Promise<{ previewKey: string }>
}) {
  const { previewKey } = await params
  const page = REVIEW_PAGE_MAP.get(previewKey as PreviewKey)
  if (!page) notFound()
  return <PreviewStage page={page} />
}
