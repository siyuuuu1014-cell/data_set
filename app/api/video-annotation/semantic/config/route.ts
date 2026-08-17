import { UnsafeLlmUrlError } from '@/services/llm-url-policy'
import { deploymentMutationDenied } from '@/services/video-annotation/admin-access'
import type { NextRequest } from 'next/server'
import {
  normalizeVideoSemanticConfig,
  publicVideoSemanticConfig,
  readVideoSemanticConfig,
  writeVideoSemanticConfig,
  VideoSemanticConfigError,
  type VideoSemanticConfig,
} from '@/services/video-annotation/remote-semantic-config'

export async function GET() {
  try {
    const config = await readVideoSemanticConfig()
    return Response.json(publicVideoSemanticConfig(config))
  } catch (error) {
    // A corrupt config file must return a JSON error like POST does, not an
    // HTML 500 page.
    const message = error instanceof Error ? error.message : '读取视频语义配置失败'
    return Response.json(
      { error: message },
      { status: error instanceof VideoSemanticConfigError || error instanceof SyntaxError ? 400 : 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const denied = deploymentMutationDenied(request)
  if (denied) return denied
  try {
    const body = await request.json() as Partial<VideoSemanticConfig>
    const existing = await readVideoSemanticConfig()
    const config = normalizeVideoSemanticConfig(body, existing)
    await writeVideoSemanticConfig(config)
    return Response.json(publicVideoSemanticConfig(config))
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存视频语义配置失败'
    return Response.json(
      { error: message },
      { status: error instanceof UnsafeLlmUrlError || error instanceof VideoSemanticConfigError || error instanceof SyntaxError ? 400 : 500 },
    )
  }
}
