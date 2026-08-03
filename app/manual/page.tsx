import type { Metadata } from 'next'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ManualPageClient } from '@/components/manual/ManualPageClient'

export const metadata: Metadata = {
  title: '用户手册 · NUWA',
  description: 'NUWA 本地智能数据工作台用户手册',
}

export default async function ManualPage() {
  const [zhSource, enSource] = await Promise.all([
    readFile(path.join(process.cwd(), '用户手册.md'), 'utf8'),
    readFile(path.join(process.cwd(), 'README.md'), 'utf8'),
  ])

  return <ManualPageClient zhSource={zhSource} enSource={enSource} />
}
