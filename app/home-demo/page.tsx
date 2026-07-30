import type { Metadata } from 'next'
import { NuwaHome } from '@/components/home-demo/NuwaHome'

export const metadata: Metadata = {
  title: 'Nuwa · 智能数据工作台',
  description: '进入 Nuwa 数据合成与视频标注工作区。',
}

export default function HomeDemoPage() {
  return <NuwaHome />
}
