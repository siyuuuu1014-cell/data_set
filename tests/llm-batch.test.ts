import assert from 'node:assert/strict'
import test from 'node:test'
import { callLlmBatch } from '../services/llm'

// ── callLlmBatch: ordering, retry, failure handling ──

test('llm batch preserves order and splits chunks correctly', async () => {
  const calls: string[][] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { userPrompts?: string[] }
    calls.push(body.userPrompts || [])
    return new Response(JSON.stringify({ results: (body.userPrompts || []).map((_, i) => `v${i}`) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const prompts = Array.from({ length: 45 }, (_, i) => `p${i}`)
    const results = await callLlmBatch('sys', prompts)
    assert.equal(results.length, 45)
    // Chunking: 20 + 20 + 5
    assert.equal(calls.length, 3)
    assert.equal(calls[0].length, 20)
    assert.equal(calls[2].length, 5)
    assert.equal(results[0], 'v0')
    assert.equal(results[44], 'v4')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('llm batch retries once and yields null (not empty string) on final failure', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    return new Response(JSON.stringify({ error: 'boom' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const results = await callLlmBatch('sys', ['a', 'b'])
    assert.equal(attempts, 2, 'one chunk × one retry')
    assert.equal(results.length, 2)
    assert.equal(results[0], null, 'failed chunk must yield null, not ""')
    assert.equal(results[1], null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('llm batch keeps successful chunks when only some fail', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { userPrompts?: string[] }
    const prompts = body.userPrompts || []
    if (prompts.some(p => p.startsWith('fail:'))) {
      return new Response(JSON.stringify({ error: 'nope' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ results: prompts.map(p => `${p}!`) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    // First chunk contains a failing prompt; second chunk is clean.
    const prompts = Array.from({ length: 21 }, (_, i) => (i < 20 ? `fail:p${i}` : `p${i}`))
    const results = await callLlmBatch('sys', prompts)
    assert.equal(results.length, 21)
    assert.equal(results[0], null, 'chunk with failing prompt → null')
    assert.equal(results[20], 'p20!', 'clean chunk succeeded')
  } finally {
    globalThis.fetch = originalFetch
  }
})
