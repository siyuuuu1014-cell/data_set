import { UnsafeLlmUrlError } from '@/services/llm-url-policy'
import {
  normalizeVideoSemanticConfig,
  readVideoSemanticConfig,
  VideoSemanticConfigError,
  type VideoSemanticConfig,
} from '@/services/video-annotation/remote-semantic-config'
import { testWorkerRemoteSemantic } from '@/services/video-annotation/worker-client'

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<VideoSemanticConfig>
    const existing = await readVideoSemanticConfig()
    const config = normalizeVideoSemanticConfig({ ...body, mode: 'remote' }, existing)
    const result = await testWorkerRemoteSemantic(config)
    return Response.json(result)
  } catch (error) {
    const invalidRequest = error instanceof UnsafeLlmUrlError || error instanceof VideoSemanticConfigError || error instanceof SyntaxError
    return Response.json(
      { error: error instanceof Error ? error.message : '远程视频语义连接测试失败' },
      { status: invalidRequest ? 400 : 502 },
    )
  }
}
