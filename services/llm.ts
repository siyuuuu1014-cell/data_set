/**
 * All LLM calls go through /api/llm, which reads config server-side.
 */

export async function callLlm(
  systemPrompt: string,
  userPrompt: string,
  cacheKey?: string
): Promise<string> {
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userPrompt, cacheKey }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || `LLM API error ${res.status}`)
  }
  return data.content || ''
}

export async function callLlmBatch(
  systemPrompt: string,
  userPrompts: string[]
): Promise<string[]> {
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userPrompts }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || `LLM API error ${res.status}`)
  }
  return data.results || []
}

export async function callLlmVision(
  systemPrompt: string,
  userPrompt: string,
  images: string[]
): Promise<string> {
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userPrompt, images }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || `LLM API error ${res.status}`)
  }
  return data.content || ''
}

export async function testLlmConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: 'Reply with only the word "OK".',
        userPrompt: 'Ping',
      }),
    })
    const data = await res.json()
    if (res.ok) return { ok: true }
    return { ok: false, error: data.error }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络请求失败' }
  }
}
