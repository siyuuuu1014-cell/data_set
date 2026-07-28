import { UnsafeLlmUrlError } from '@/services/llm-url-policy'
import {
  normalizeVideoSemanticConfig,
  publicVideoSemanticConfig,
  readVideoSemanticConfig,
  writeVideoSemanticConfig,
  VideoSemanticConfigError,
  type VideoSemanticConfig,
} from '@/services/video-annotation/remote-semantic-config'

export async function GET() {
  const config = await readVideoSemanticConfig()
  return Response.json(publicVideoSemanticConfig(config))
}

export async function POST(request: Request) {
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
