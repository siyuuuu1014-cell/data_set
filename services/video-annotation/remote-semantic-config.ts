import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ApiFormat } from '@/services/types'
import { UnsafeLlmUrlError, validateLlmBaseUrl } from '@/services/llm-url-policy'

export type VideoSemanticMode = 'local' | 'remote'

export interface VideoSemanticConfig {
  mode: VideoSemanticMode
  apiKey: string
  baseUrl: string
  model: string
  apiFormat: ApiFormat
}

export interface PublicVideoSemanticConfig {
  mode: VideoSemanticMode
  baseUrl: string
  model: string
  apiFormat: ApiFormat
  hasApiKey: boolean
  configured: boolean
}

export class VideoSemanticConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoSemanticConfigError'
  }
}

const CONFIG_FILE = join(process.cwd(), 'configs', 'video-semantic-config.json')

export const DEFAULT_VIDEO_SEMANTIC_CONFIG: VideoSemanticConfig = {
  mode: 'local',
  apiKey: '',
  baseUrl: '',
  model: '',
  apiFormat: 'openai',
}

export async function readVideoSemanticConfig(): Promise<VideoSemanticConfig> {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_VIDEO_SEMANTIC_CONFIG }
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, 'utf8')) as Partial<VideoSemanticConfig>
    return normalizeVideoSemanticConfig(raw)
  } catch (error) {
    if (error instanceof VideoSemanticConfigError || error instanceof UnsafeLlmUrlError) throw error
    throw new VideoSemanticConfigError('视频语义配置文件无效')
  }
}

export function normalizeVideoSemanticConfig(
  value: Partial<VideoSemanticConfig>,
  existing: VideoSemanticConfig = DEFAULT_VIDEO_SEMANTIC_CONFIG,
): VideoSemanticConfig {
  const mode = value.mode ?? existing.mode
  const apiFormat = value.apiFormat ?? existing.apiFormat
  if (mode !== 'local' && mode !== 'remote') throw new VideoSemanticConfigError('视频语义模式无效')
  if (apiFormat !== 'openai' && apiFormat !== 'anthropic') throw new VideoSemanticConfigError('API 格式无效')

  const config: VideoSemanticConfig = {
    mode,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : existing.apiKey,
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl.trim() : existing.baseUrl,
    model: typeof value.model === 'string' ? value.model.trim() : existing.model,
    apiFormat,
  }

  if (config.baseUrl) validateLlmBaseUrl(config.baseUrl)
  if (config.mode === 'remote') {
    if (!config.baseUrl) throw new VideoSemanticConfigError('远程模式需要 Base URL')
    if (!config.model) throw new VideoSemanticConfigError('远程模式需要视觉模型名称')
  }
  return config
}

export async function writeVideoSemanticConfig(config: VideoSemanticConfig): Promise<void> {
  await mkdir(dirname(CONFIG_FILE), { recursive: true })
  const tempFile = `${CONFIG_FILE}.tmp`
  await writeFile(tempFile, JSON.stringify(config, null, 2), 'utf8')
  await rename(tempFile, CONFIG_FILE)
}

export function publicVideoSemanticConfig(config: VideoSemanticConfig): PublicVideoSemanticConfig {
  return {
    mode: config.mode,
    baseUrl: config.baseUrl,
    model: config.model,
    apiFormat: config.apiFormat,
    hasApiKey: Boolean(config.apiKey),
    configured: config.mode === 'local' || Boolean(config.baseUrl && config.model),
  }
}
