/**
 * Safe code execution for numeric data generation.
 * Executes user-provided code in a sandboxed new Function context,
 * providing row index and existing data access.
 */

import type { DateRange } from './types'
import { CITY_DATA } from './city-data'

export interface CodeGenContext {
  /** Current row index (0-based) */
  index: number
  /** Total rows being generated */
  totalRows: number
  /** Previous values generated in this column (for this batch) */
  previousValues: unknown[]
  /** Reference table data: { tableName: rows[] } */
  refData: Record<string, Record<string, unknown>[]>
  /** Random integer between min (inclusive) and max (inclusive) */
  randomInt: (min: number, max: number) => number
  /** Random float between min and max */
  randomFloat: (min: number, max: number) => number
  /** Pick a random element from an array */
  pick: <T>(arr: T[]) => T
}

export function executeCodeGen(code: string, context: CodeGenContext): unknown {
  // Helper functions available in sandbox
  const helpers = {
    randomInt: (min: number, max: number) =>
      Math.floor(Math.random() * (max - min + 1)) + min,
    randomFloat: (min: number, max: number) =>
      Math.random() * (max - min) + min,
    pick: <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)],
  }

  // Important: pass context properties explicitly, not the context object itself
  // to avoid exposing internal references
  const fn = new Function(
    'index',
    'totalRows',
    'previousValues',
    'refData',
    'randomInt',
    'randomFloat',
    'pick',
    code.includes('return ') ? code : `return (${code})`
  )

  return fn(
    context.index,
    context.totalRows,
    context.previousValues,
    context.refData,
    helpers.randomInt,
    helpers.randomFloat,
    helpers.pick
  )
}

/**
 * Generate a date value based on a code expression or random range
 */
export function generateDate(code?: string, format?: string): string {
  if (code) {
    try {
      const result = executeCodeGen(code, {
        index: 0,
        totalRows: 1,
        previousValues: [],
        refData: {},
        randomInt: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
        randomFloat: (a, b) => Math.random() * (b - a) + a,
        pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
      })
      return String(result)
    } catch {
      // fall through to random
    }
  }
  // Default: random date in last 5 years
  const start = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000)
  const end = new Date()
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
  return formatDate(d, format || 'date')
}

export function formatDate(d: Date, format: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  switch (format) {
    case 'iso':
      return d.toISOString()
    case 'datetime':
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    case 'date':
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    case 'date_slash':
      return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
    case 'date_us':
      return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`
    case 'date_eu':
      return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
    case 'unix_s':
      return String(Math.floor(d.getTime() / 1000))
    case 'unix_ms':
      return String(d.getTime())
    default:
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
}

const DAY_MS = 86400000

export function generateDateFromDistribution(dist: DateRange[], format: string): string {
  const total = dist.reduce((s, r) => s + r.ratio, 0)
  if (total <= 0) {
    // All ratios zero: uniform random across last 5 years
    const d = new Date(Date.now() - Math.random() * 5 * 365 * DAY_MS)
    return formatDate(d, format)
  }
  // Weighted random pick
  let r = Math.random() * total
  for (const range of dist) {
    r -= range.ratio
    if (r <= 0) {
      const now = Date.now()
      const maxDays = range.maxDays > 0 ? range.maxDays : range.minDays + 365
      const minMs = now - maxDays * DAY_MS
      const maxMs = now - range.minDays * DAY_MS
      const d = new Date(minMs + Math.random() * (maxMs - minMs))
      return formatDate(d, format)
    }
  }
  // Fallback
  return formatDate(new Date(), format)
}

// ──── Phone number generators ────

// Phone rules per country: { code, prefixes[], length }
const PHONE_RULES: Record<string, { code: string; prefixes: string[]; length: number }> = {
  CN: { code: '+86', prefixes: ['13', '15', '16', '17', '18', '19'], length: 11 },
  US: { code: '+1',  prefixes: ['201','202','212','213','214','305','310','312','315','347','404','415','425','469','503','512','602','615','646','702','713','773','786','805','813','817','832','858','909','914','917','949','951','972'], length: 10 },
  JP: { code: '+81', prefixes: ['090','080','070','050'], length: 11 },
  KR: { code: '+82', prefixes: ['010','011','016','017','018','019'], length: 11 },
  GB: { code: '+44', prefixes: ['07'], length: 11 },
  DE: { code: '+49', prefixes: ['015','016','017'], length: 12 },
  FR: { code: '+33', prefixes: ['06','07'], length: 10 },
  IN: { code: '+91', prefixes: ['7','8','9'], length: 10 },
  BR: { code: '+55', prefixes: ['119','219','319','419','519','619','719','819','919','129','229','329','429','529','629','729','829','929'], length: 11 },
  AU: { code: '+61', prefixes: ['04'], length: 10 },
}

export function generatePhone(country: string): string {
  const rules = PHONE_RULES[country] || PHONE_RULES.CN
  const prefix = rules.prefixes[Math.floor(Math.random() * rules.prefixes.length)]
  const remaining = rules.length - prefix.length - 1 // -1 for country code formatting
  let number = prefix
  for (let i = 0; i < remaining; i++) {
    number += Math.floor(Math.random() * 10)
  }
  return `${rules.code} ${number}`
}

// ──── City generation ────

export function generateCity(country: string): string {
  const entries = CITY_DATA[country] || CITY_DATA.CN
  const province = entries[Math.floor(Math.random() * entries.length)]
  return province.cities[Math.floor(Math.random() * province.cities.length)]
}

// ──── ID generators ────

let _snowflakeSeq = BigInt(0)
const SNOWFLAKE_EPOCH = BigInt(1700000000000) // 2023-11-14 in ms

export function generateUuid4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// UUID v7: time-ordered UUID per RFC 9562
export function generateUuid7(): string {
  const ts = BigInt(Date.now())
  const rand = new Uint8Array(10)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(rand)
  } else {
    for (let i = 0; i < 10; i++) {
      rand[i] = (Math.random() * 256) | 0
    }
  }
  // Build the 16 bytes: 48-bit timestamp + 74 bits random (with version/variant)
  const bytes = new Uint8Array(16)
  // Timestamp: 48 bits big-endian into bytes 0-5
  bytes[0] = Number((ts >> BigInt(40)) & BigInt(0xff))
  bytes[1] = Number((ts >> BigInt(32)) & BigInt(0xff))
  bytes[2] = Number((ts >> BigInt(24)) & BigInt(0xff))
  bytes[3] = Number((ts >> BigInt(16)) & BigInt(0xff))
  bytes[4] = Number((ts >> BigInt(8)) & BigInt(0xff))
  bytes[5] = Number(ts & BigInt(0xff))
  // Fill random bytes 6-15
  bytes[6] = rand[0]
  bytes[7] = rand[1]
  bytes[8] = rand[2]
  bytes[9] = rand[3]
  bytes[10] = rand[4]
  bytes[11] = rand[5]
  bytes[12] = rand[6]
  bytes[13] = rand[7]
  bytes[14] = rand[8]
  bytes[15] = rand[9]
  // Set version (7) in top 4 bits of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  // Set variant (10) in top 2 bits of byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}

export function generateSnowflake(): string {
  const now = BigInt(Date.now())
  const ts = (now - SNOWFLAKE_EPOCH) << BigInt(22)
  const worker = (BigInt(Math.floor(Math.random() * 31)) & BigInt(0x1f)) << BigInt(17)
  _snowflakeSeq = _snowflakeSeq + BigInt(1)
  const seq = (_snowflakeSeq & BigInt(0x1f)) << BigInt(12)
  return String(ts | worker | seq)
}

let _autoIncCounters: Record<string, number> = {}

export function resetAutoIncrement(key?: string) {
  if (key) {
    delete _autoIncCounters[key]
  } else {
    _autoIncCounters = {}
  }
}

export function generateAutoIncrement(key: string): number {
  _autoIncCounters[key] = (_autoIncCounters[key] || 0) + 1
  return _autoIncCounters[key]
}

// ──── CUID2-style ────
// Format: random lowercase alphanumeric, ~24 chars, starts with letter

function randomBytes(count: number): Uint8Array {
  const arr = new Uint8Array(count)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < count; i++) arr[i] = Math.floor(Math.random() * 256)
  }
  return arr
}

export function generateCuid2(): string {
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = randomBytes(24)
  let id = ''
  // Start with a letter
  id += ALPHABET[bytes[0] % 26]
  for (let i = 1; i < 24; i++) {
    id += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return id
}

// ──── MongoDB ObjectID ────
// 12 bytes = 24 hex chars. 4 bytes timestamp + 5 bytes random + 3 bytes counter

let _objectIdCounter = Math.floor(Math.random() * 0xffffff)

export function generateObjectId(): string {
  const ts = Math.floor(Date.now() / 1000)
  _objectIdCounter = (_objectIdCounter + 1) & 0xffffff
  const rand = randomBytes(5)
  const hex = [
    (ts >>> 24) & 0xff, (ts >>> 16) & 0xff, (ts >>> 8) & 0xff, ts & 0xff,
    rand[0], rand[1], rand[2], rand[3], rand[4],
    (_objectIdCounter >>> 16) & 0xff, (_objectIdCounter >>> 8) & 0xff, _objectIdCounter & 0xff,
  ]
  return hex.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ──── Nano ID ────
// Compact URL-safe, 21 chars from 64-char alphabet

export function generateNanoid(size = 21): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  const bytes = randomBytes(size)
  let id = ''
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i] & 63]
  }
  return id
}

// ──── ULID ────
// 26 chars: 10 chars timestamp (Crockford base32) + 16 chars random

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeUlidTime(ts: number): string {
  let s = ''
  for (let i = 0; i < 10; i++) {
    s = ULID_ALPHABET[ts % 32] + s
    ts = Math.floor(ts / 32)
  }
  return s
}

function encodeUlidRandom(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < 16; i++) {
    s += ULID_ALPHABET[bytes[i] & 0x1f]
  }
  return s
}

export function generateUlid(): string {
  const ts = Date.now()
  const rand = randomBytes(16)
  return encodeUlidTime(ts) + encodeUlidRandom(rand)
}

export function generateId(format: string, index: number, key: string): string | number {
  switch (format) {
    case 'uuid4':
      return generateUuid4()
    case 'uuid7':
      return generateUuid7()
    case 'snowflake':
      return generateSnowflake()
    case 'auto_increment':
      return generateAutoIncrement(key)
    case 'cuid2':
      return generateCuid2()
    case 'objectid':
      return generateObjectId()
    case 'nanoid':
      return generateNanoid()
    case 'ulid':
      return generateUlid()
    default:
      return generateUuid4()
  }
}

/**
 * Generate a boolean value as 1 or 0.
 */
export function generateBoolean(trueRatio?: number, code?: string): number {
  if (code) {
    try {
      const result = executeCodeGen(code, {
        index: 0,
        totalRows: 1,
        previousValues: [],
        refData: {},
        randomInt: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
        randomFloat: (a, b) => Math.random() * (b - a) + a,
        pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
      })
      return result ? 1 : 0
    } catch {
      // fall through to random
    }
  }
  const ratio = trueRatio != null ? trueRatio / 100 : 0.5
  return Math.random() < ratio ? 1 : 0
}
