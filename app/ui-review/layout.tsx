import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Nuwa UI Review',
  description: 'Nuwa 全项目 UI 优化隔离预览',
}

export default function UiReviewLayout({ children }: { children: React.ReactNode }) {
  return children
}
