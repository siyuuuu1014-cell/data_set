import type { Metadata } from 'next'
import { NuwaHome } from '@/components/home/NuwaHome'

export const metadata: Metadata = {
  title: 'NUWA · 智能数据工作台',
  description: '数据合成与视频标注的一体化工作入口。',
}

export default function HomePage() {
  return <NuwaHome />
}
