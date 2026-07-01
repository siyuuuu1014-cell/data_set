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

const BATCH_SIZE = 20
const MAX_CONCURRENT = 10

/** Post a single chunk to /api/llm, with one retry on failure. */
async function postChunk(systemPrompt: string, chunk: string[]): Promise<string[]> {
  const doFetch = async () => {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt, userPrompts: chunk }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `LLM API error ${res.status}`)
    return (data.results || []) as string[]
  }

  try {
    return await doFetch()
  } catch (err) {
    // Retry once
    try {
      return await doFetch()
    } catch (retryErr) {
      console.error(`[llm batch] chunk failed after retry:`, retryErr)
      return new Array(chunk.length).fill('')
    }
  }
}

/**
 * Generate values for many rows via concurrent LLM batch calls.
 * Splits prompts into chunks of BATCH_SIZE, fires up to MAX_CONCURRENT
 * requests in parallel, merges results in original order.
 */
export async function callLlmBatch(
  systemPrompt: string,
  userPrompts: string[]
): Promise<string[]> {
  const total = userPrompts.length

  // Split into chunks
  const chunks: string[][] = []
  for (let i = 0; i < total; i += BATCH_SIZE) {
    chunks.push(userPrompts.slice(i, i + BATCH_SIZE))
  }

  // Pre-alloc results array to preserve order
  const chunkResults: string[][] = new Array(chunks.length)

  // Worker pool: each worker grabs the next unprocessed chunk index
  let cursor = 0
  const workerCount = Math.min(MAX_CONCURRENT, chunks.length)

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= chunks.length) break
      chunkResults[idx] = await postChunk(systemPrompt, chunks[idx])
    }
  })

  await Promise.all(workers)

  // Flatten preserving original order
  const merged: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const res = chunkResults[i]
    for (let j = 0; j < chunks[i].length; j++) {
      merged.push(res?.[j] ?? '')
    }
  }

  return merged
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
