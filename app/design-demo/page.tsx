import type { Metadata } from 'next'
import { DesignDemoWorkspace } from '@/components/design-demo/DesignDemoWorkspace'

export const metadata: Metadata = {
  title: 'Nuwa 视频标注工作台 · UI Demo',
  description: 'Nuwa 视频标注工作台独立界面演示',
}

export default function DesignDemoPage() {
  return <DesignDemoWorkspace />
}
