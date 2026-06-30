import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { LlmConfig, ApiFormat } from '@/services/types'

const CONFIG_FILE = join(process.cwd(), 'configs', 'llm-config.json')

function getConfig(): LlmConfig {
  if (existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    } catch { /* ignore */ }
  }
  throw new Error('LLM 未配置，请先在设置页配置 API')
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { systemPrompt, userPrompt, userPrompts } = body as {
      systemPrompt: string
      userPrompt?: string
      userPrompts?: string[]
    }

    const config = getConfig()

    if (userPrompts && userPrompts.length > 0) {
      const results = await batchGenerate(config, systemPrompt, userPrompts)
      return Response.json({ results })
    } else if (userPrompt) {
      const content = await singleGenerate(config, systemPrompt, userPrompt)
      return Response.json({ content })
    } else {
      return Response.json({ error: '缺少提示词' }, { status: 400 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误'
    return Response.json({ error: message }, { status: 500 })
  }
}

// ──── OpenAI format ────

async function openaiGenerate(config: LlmConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const res = await doFetch(url, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  }, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
  }, 'OpenAI')

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// ──── Anthropic format ────

async function anthropicGenerate(config: LlmConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/messages`
  const res = await doFetch(url, {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  }, {
    model: config.model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt },
    ],
  }, 'Anthropic')

  const data = await res.json()
  console.log('[Anthropic Response]', JSON.stringify(data).slice(0, 500))

  // Standard Anthropic format: { content: [{ type: "text", text: "..." }] }
  if (data.content?.[0]?.text) {
    return data.content[0].text
  }
  // Alternative: OpenAI-style format some proxies use
  if (data.choices?.[0]?.message?.content) {
    return data.choices[0].message.content
  }
  // Content might be a string directly
  if (typeof data.content === 'string') {
    return data.content
  }
  // Fallback: try to find text anywhere in response
  if (data.content && Array.isArray(data.content)) {
    return data.content.map((c: { text?: string; type?: string }) => c.text || c.type || '').join('')
  }
  console.error('[Anthropic] Unknown response format:', Object.keys(data))
  return ''
}

// ──── Shared fetch ────

async function doFetch(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`无法连接到 ${url} (${msg})\n请检查 Base URL 和 API 格式是否正确`)
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (res.status === 404) {
      throw new Error(
        `端点不存在 (404): ${url}\n` +
        `当前 API 格式: ${label}\n` +
        `OpenAI 格式 → 请求 /chat/completions\n` +
        `Anthropic 格式 → 请求 /messages`
      )
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`认证失败 (${res.status})。请检查 API Key 是否正确`)
    }
    throw new Error(`API 错误 ${res.status}: ${errText || '(无响应内容)'}\n请求地址: ${url}\nAPI 格式: ${label}`)
  }

  return res
}

// ──── Dispatch ────

async function singleGenerate(config: LlmConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  if (config.apiFormat === 'anthropic') {
    return anthropicGenerate(config, systemPrompt, userPrompt)
  }
  return openaiGenerate(config, systemPrompt, userPrompt)
}

// ──── Batch ────

const BATCH_CHUNK_SIZE = 20

async function batchGenerate(config: LlmConfig, systemPrompt: string, userPrompts: string[]): Promise<string[]> {
  const results: string[] = []
  for (let i = 0; i < userPrompts.length; i += BATCH_CHUNK_SIZE) {
    const chunk = userPrompts.slice(i, i + BATCH_CHUNK_SIZE)
    const combinedPrompt = buildBatchPrompt(chunk)
    const content = await singleGenerate(config, systemPrompt, combinedPrompt)
    const parsed = parseBatchResponse(content)
    while (parsed.length < chunk.length) { parsed.push('') }
    results.push(...parsed.slice(0, chunk.length))
  }
  return results
}

function buildBatchPrompt(prompts: string[]): string {
  return `Generate ${prompts.length} items based on the following rules. Return ONLY a JSON array of strings, no other text.

${prompts.map((p, i) => `Item ${i + 1}: ${p}`).join('\n')}

Output format: ["value1", "value2", ...]`
}

function parseBatchResponse(res: string): string[] {
  console.log('[Batch Response]', res.slice(0, 300))

  // Try to find a JSON array in the response
  const jsonMatch = res.match(/\[[\s\S]*?\]/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(String)
      }
    } catch {
      console.log('[Batch] JSON array parse failed, trying alternatives')
    }
  }

  // Try extracting quoted strings: "value1", "value2"
  const quoted = res.match(/"([^"]*)"/g)
  if (quoted && quoted.length > 0) {
    return quoted.map(q => q.replace(/^"|"$/g, ''))
  }

  // Split by newlines, filter empty, remove numbering
  const lines = res.split('\n').map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean)
  if (lines.length > 0) return lines

  return [res]
}
