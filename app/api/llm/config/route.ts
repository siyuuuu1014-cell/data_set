import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { LlmConfig } from '@/services/types'

const CONFIG_DIR = join(process.cwd(), 'configs')
const CONFIG_FILE = join(CONFIG_DIR, 'llm-config.json')

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function readConfig(): LlmConfig | null {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch { /* ignore */ }
  return null
}

function writeConfig(config: LlmConfig) {
  ensureDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

export async function GET() {
  const config = readConfig()
  return Response.json({
    configured: !!config,
    model: config?.model || '',
    baseUrl: config?.baseUrl || '',
    apiFormat: config?.apiFormat || 'openai',
    // Never return the API key to the client
    hasApiKey: !!config?.apiKey,
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const existing = readConfig()

    const config: LlmConfig = {
      apiKey: body.apiKey ?? existing?.apiKey ?? '',
      baseUrl: body.baseUrl ?? existing?.baseUrl ?? '',
      model: body.model ?? existing?.model ?? '',
      apiFormat: body.apiFormat ?? existing?.apiFormat ?? 'openai',
    }

    writeConfig(config)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: '保存失败' }, { status: 500 })
  }
}
