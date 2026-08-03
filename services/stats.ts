import type { ColumnDef } from './types'
import { CITY_DATA, getCityProvince } from './city-data'

// Pre-built city lookup: city name (longest first so '浦东新区' wins over
// shorter names) → { country, province }. Built once at module load instead of
// rescanning every row × every country × every city.
const CITY_LOOKUP: { city: string; country: string; province: string }[] = []
{
  const seen = new Map<string, string>()
  for (const [country, entries] of Object.entries(CITY_DATA)) {
    for (const entry of entries) {
      for (const city of entry.cities) {
        if (seen.has(city)) continue
        seen.set(city, country)
        CITY_LOOKUP.push({ city, country, province: entry.province })
      }
    }
  }
  CITY_LOOKUP.sort((left, right) => right.city.length - left.city.length)
}

// ──── Types ────

export interface NumStats {
  type: 'number'
  count: number
  mean: number
  median: number
  std: number
  min: number
  max: number
  q1: number
  q3: number
  histogram: { binStart: number; binEnd: number; count: number }[]
}

export interface TextStats {
  type: 'text'
  count: number
  avgLength: number
  minLength: number
  maxLength: number
  uniqueCount: number
  topWords: { word: string; count: number }[]
  cityWords: { city: string; province: string; count: number }[]
}

export interface DateStats {
  type: 'date'
  count: number
  min: string
  max: string
  spanDays: number
  byMonth: { month: string; count: number }[]
}

export interface BoolStats {
  type: 'boolean'
  count: number
  trueCount: number
  falseCount: number
  trueRatio: number
}

export interface IdStats {
  type: 'id'
  count: number
  uniqueCount: number
  duplicateCount: number
}

export interface FkStats {
  type: 'foreign_key'
  count: number
  distinctCount: number
  nullCount: number
  topValues: { value: string; count: number }[]
}

export interface PhoneStats {
  type: 'phone'
  count: number
  distinctCount: number
  nullCount: number
}

export interface CityStats {
  type: 'city'
  count: number
  distinctCount: number
  byProvince: { province: string; count: number }[]
}

export type ColumnStats = NumStats | TextStats | DateStats | BoolStats | IdStats | FkStats | PhoneStats | CityStats | { type: 'unknown'; count: number }

// ──── Main entry ────

export function computeColumnStats(
  col: ColumnDef,
  rows: Record<string, unknown>[]
): ColumnStats {
  const values = rows.map(r => r[col.name]).filter(v => v !== null && v !== undefined)

  // Imported and LLM-generated datasets can contain numeric values in a legacy
  // text column. Statistics should describe the real data instead of showing a
  // word-frequency chart for values such as rates, scores, prices, or counts.
  if (col.type === 'text' && isNumericSeries(values)) return computeNumStats(values)

  switch (col.type) {
    case 'number':
      return computeNumStats(values)
    case 'text':
      return computeTextStats(values)
    case 'date':
      return computeDateStats(values)
    case 'boolean':
      return computeBoolStats(values)
    case 'id':
      return computeIdStats(values)
    case 'foreign_key':
      return computeFkStats(values)
    case 'phone':
      return computePhoneStats(values)
    case 'city':
      return computeCityStats(col, values)
    default:
      return { type: 'unknown', count: values.length }
  }
}

function isNumericSeries(values: unknown[]): boolean {
  const populated = values.filter(value => String(value).trim() !== '')
  if (populated.length === 0) return false
  const numericCount = populated.filter(value => Number.isFinite(Number(value))).length
  return numericCount / populated.length >= 0.9
}

// ──── Number: normal distribution stats ────

function computeNumStats(values: unknown[]): NumStats {
  // Skip empty strings — Number('') is 0, which would skew mean/min/max
  const nums = values
    .map(v => (typeof v === 'string' ? v.trim() : v))
    .filter(v => v !== '' && v !== null && v !== undefined)
    .map(v => Number(v))
    .filter(Number.isFinite)
  const n = nums.length
  if (n === 0) {
    return { type: 'number', count: 0, mean: 0, median: 0, std: 0, min: 0, max: 0, q1: 0, q3: 0, histogram: [] }
  }

  const sorted = [...nums].sort((a, b) => a - b)
  const sum = nums.reduce((a, b) => a + b, 0)
  const mean = sum / n
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / n
  const std = Math.sqrt(variance)

  const median = percentile(sorted, 0.5)
  const q1 = percentile(sorted, 0.25)
  const q3 = percentile(sorted, 0.75)
  const min = sorted[0]
  const max = sorted[n - 1]

  // Histogram: 10 bins
  const binCount = Math.min(10, n)
  const binWidth = (max - min) / binCount || 1
  const histogram: NumStats['histogram'] = []
  for (let i = 0; i < binCount; i++) {
    const binStart = min + i * binWidth
    const isLast = i === binCount - 1
    // Last bucket must include the maximum value (no upper bound rounding loss)
    const binEnd = isLast ? max : binStart + binWidth
    const count = isLast
      ? sorted.filter(v => v >= binStart && v <= binEnd).length
      : sorted.filter(v => v >= binStart && v < binEnd).length
    histogram.push({
      binStart: Math.round(binStart * 100) / 100,
      binEnd: Math.round(binEnd * 100) / 100,
      count,
    })
  }

  return { type: 'number', count: n, mean, median, std, min, max, q1, q3, histogram }
}

function percentile(sorted: number[], p: number): number {
  const i = p * (sorted.length - 1)
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo)
}

// ──── Text: word frequency ────

function computeTextStats(values: unknown[]): TextStats {
  const strs = values.map(v => String(v))
  const n = strs.length
  if (n === 0) {
    return { type: 'text', count: 0, avgLength: 0, minLength: 0, maxLength: 0, uniqueCount: 0, topWords: [], cityWords: [] }
  }

  const lengths = strs.map(s => s.length)
  const avgLength = lengths.reduce((a, b) => a + b, 0) / n
  const minLength = Math.min(...lengths)
  const maxLength = Math.max(...lengths)
  const uniqueCount = new Set(strs).size

  // Word frequency (split by common CJK/non-CJK boundaries and whitespace)
  const wordMap = new Map<string, number>()
  for (const s of strs) {
    const words = tokenizeSimple(s)
    for (const w of words) {
      if (w.length >= 2) {
        wordMap.set(w, (wordMap.get(w) || 0) + 1)
      }
    }
  }

  const topWords = [...wordMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }))

  // City name detection: single pass over the pre-built index per row
  const cityMap = new Map<string, { city: string; province: string; count: number }>()
  for (const s of strs) {
    for (const { city, country, province } of CITY_LOOKUP) {
      if (s.includes(city)) {
        const key = `${country}:${city}`
        const existing = cityMap.get(key)
        if (existing) {
          existing.count++
        } else {
          cityMap.set(key, { city, province, count: 1 })
        }
      }
    }
  }

  const cityWords = [...cityMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  return { type: 'text', count: n, avgLength, minLength, maxLength, uniqueCount, topWords, cityWords }
}

// Simple tokenizer: split on whitespace/punctuation, also extract CJK bigrams
function tokenizeSimple(s: string): string[] {
  const result: string[] = []
  // Split into segments: sequences of CJK chars, or sequences of word chars
  const segments = s.split(/[\s,，。.!！?？;；:：、""''""「」『』【】（）()\[\]{}《》<>\/\\|@#$%^&*+=~`-]+/)
  for (const seg of segments) {
    if (!seg) continue
    // Check if it's mostly CJK
    if (/[\u4e00-\u9fff]/.test(seg)) {
      // Extract CJK bigrams
      const cjk = seg.replace(/[^\u4e00-\u9fff]/g, '')
      if (cjk.length === 1) {
        result.push(cjk)
      } else {
        for (let i = 0; i < cjk.length - 1; i++) {
          result.push(cjk.slice(i, i + 2))
        }
      }
    } else {
      // Non-CJK: split by word boundary
      if (seg.length <= 15) {
        result.push(seg.toLowerCase())
      }
    }
  }
  return result
}

// ──── Date: range and distribution ────

function computeDateStats(values: unknown[]): DateStats {
  const n = values.length
  if (n === 0) {
    return { type: 'date', count: 0, min: '', max: '', spanDays: 0, byMonth: [] }
  }

  const parsed: { d: Date; label: string }[] = []
  for (const v of values) {
    const d = parseDate(String(v))
    if (d) parsed.push({ d, label: String(v) })
  }

  if (parsed.length === 0) {
    return { type: 'date', count: n, min: '', max: '', spanDays: 0, byMonth: [] }
  }

  parsed.sort((a, b) => a.d.getTime() - b.d.getTime())
  const minD = parsed[0].d
  const maxD = parsed[parsed.length - 1].d

  // ── by month ──
  const spanDays = Math.round((maxD.getTime() - minD.getTime()) / 86400000)

  // Monthly distribution — no truncation: cross-year data must keep every month
  const monthMap = new Map<string, number>()
  for (const p of parsed) {
    const key = `${p.d.getFullYear()}-${String(p.d.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, (monthMap.get(key) || 0) + 1)
  }
  const byMonth = [...monthMap.entries()]
    .sort()
    .map(([month, count]) => ({ month, count }))

  return { type: 'date', count: n, min: String(parsed[0].label), max: String(parsed[parsed.length - 1].label), spanDays, byMonth }
}

function parseDate(s: string): Date | null {
  // Try ISO, common formats, Unix timestamps
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d
  // Try numeric timestamp
  const n = Number(s)
  if (!isNaN(n)) {
    // seconds vs milliseconds
    const d2 = n > 1e12 ? new Date(n) : new Date(n * 1000)
    if (!isNaN(d2.getTime())) return d2
  }
  return null
}

// ──── Boolean ────

function computeBoolStats(values: unknown[]): BoolStats {
  const n = values.length
  if (n === 0) return { type: 'boolean', count: 0, trueCount: 0, falseCount: 0, trueRatio: 0 }
  const trueCount = values.filter(v => v === true || v === 1 || v === 'true' || v === '1').length
  return { type: 'boolean', count: n, trueCount, falseCount: n - trueCount, trueRatio: trueCount / n }
}

// ──── ID ────

function computeIdStats(values: unknown[]): IdStats {
  const n = values.length
  const uniqueCount = new Set(values.map(String)).size
  return { type: 'id', count: n, uniqueCount, duplicateCount: n - uniqueCount }
}

// ──── Foreign key ────

function computeFkStats(values: unknown[]): FkStats {
  const n = values.length
  const nullCount = values.filter(v => v === null || v === undefined).length
  const strValues = values.filter(v => v !== null && v !== undefined).map(String)
  const distinctCount = new Set(strValues).size
  const freq = new Map<string, number>()
  for (const s of strValues) {
    freq.set(s, (freq.get(s) || 0) + 1)
  }
  const topValues = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([value, count]) => ({ value, count }))
  return { type: 'foreign_key', count: n, distinctCount, nullCount, topValues }
}

// ──── Phone ────

function computePhoneStats(values: unknown[]): PhoneStats {
  const n = values.length
  const nullCount = values.filter(v => v === null || v === undefined).length
  const strValues = values.filter(v => v !== null && v !== undefined).map(String)
  return { type: 'phone', count: n, distinctCount: new Set(strValues).size, nullCount }
}

function computeCityStats(col: ColumnDef, values: unknown[]): CityStats {
  const n = values.length
  const strValues = values.filter(v => v !== null && v !== undefined).map(String)
  const country = col.cityCountry || 'CN'
  const provinceMap = new Map<string, number>()
  for (const v of strValues) {
    const province = getCityProvince(country, v)
    provinceMap.set(province, (provinceMap.get(province) || 0) + 1)
  }
  const byProvince = [...provinceMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([province, count]) => ({ province, count }))
  return { type: 'city', count: n, distinctCount: new Set(strValues).size, byProvince }
}
