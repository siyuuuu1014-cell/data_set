/**
 * Code expression cache — stores LLM-generated JavaScript expressions
 * keyed by prompt, so repeated prompts reuse the same code without
 * calling the LLM again.
 *
 * Cache file: configs/code-cache.json
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { isSafeExpression } from './safe-expression'

const CACHE_FILE = join(process.cwd(), 'configs', 'code-cache.json')

interface CacheEntry {
  /** The raw JavaScript expression */
  expression: string
  /** When this entry was created (ISO string) */
  createdAt: string
  /** How many times this entry has been reused */
  hitCount: number
}

type CacheStore = Record<string, CacheEntry>

function loadCache(): CacheStore {
  if (existsSync(CACHE_FILE)) {
    try {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
    } catch { /* corrupt file, start fresh */ }
  }
  return {}
}

function saveCache(store: CacheStore): void {
  const dir = join(process.cwd(), 'configs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), 'utf-8')
}

/**
 * Look up a cached expression by cache key.
 * Returns the expression or null if not found.
 */
export function getCachedCode(key: string): string | null {
  const store = loadCache()
  const entry = store[key]
  if (entry && entry.expression) {
    entry.hitCount += 1
    saveCache(store)
    return entry.expression
  }
  return null
}

/**
 * Save a generated expression to the cache.
 */
export function setCachedCode(key: string, expression: string): void {
  const store = loadCache()
  store[key] = {
    expression,
    createdAt: new Date().toISOString(),
    hitCount: 1,
  }
  saveCache(store)
}

/**
 * Remove a cached entry.
 */
export function deleteCachedCode(key: string): void {
  const store = loadCache()
  delete store[key]
  saveCache(store)
}

/**
 * Validate that a code string is a valid, executable JavaScript expression.
 */
export function isValidExpression(code: string): boolean {
  if (!code || code.length > 350) return false
  if (/[\u4e00-\u9fff]/.test(code)) return false
  return isSafeExpression(code)
}

/**
 * Get all cached entries (for display / management).
 */
export function getAllCachedCodes(): Record<string, CacheEntry> {
  return loadCache()
}
