import type { ColumnDef, DateRange, TableDef } from './types'
import { callLlm, callLlmBatch } from './llm'
import { generateDate, generateBoolean, generateId, resetAutoIncrement, generateDateFromDistribution, generatePhone, generateCity, formatDate } from './code-gen'
import { compileSafeExpression } from './safe-expression'

export interface GenOptions {
  rowCount: number
  allTables: TableDef[]
  projectId?: string
}

/**
 * Generate data for a table, one column at a time.
 * - Text: LLM generates values directly
 * - Number: LLM generates code from prompt, then code executes row-by-row
 * - Date: LLM generates code from prompt, then code executes row-by-row
 * - Boolean: generates 1 or 0
 * - Foreign_key: sample from parent table
 */
export async function generateTableData(
  table: TableDef,
  options: GenOptions
): Promise<Record<string, unknown>[]> {
  const { rowCount, allTables, projectId } = options

  // Prepare reference data from parent tables (for both foreign_key and imported columns)
  const refData: Record<string, Record<string, unknown>[]> = {}
  const fetchedKeys = new Set<string>() // avoid duplicate Parquet fetches

  for (const col of table.columns) {
    if (!col.foreignTable) continue
    const parentTable = allTables.find(t => t.id === col.foreignTable || t.name === col.foreignTable)
    if (!parentTable) continue

    if (parentTable.rows.length > 0) {
      // Key by both id and name so resolver can find it either way
      refData[parentTable.id] = parentTable.rows
      refData[parentTable.name] = parentTable.rows
    } else if (projectId && !fetchedKeys.has(parentTable.name)) {
      // In-memory data is empty - load full rows from Parquet
      fetchedKeys.add(parentTable.name)
      try {
        const url = `/api/data/fk-values?projectId=${encodeURIComponent(projectId)}&tableId=${encodeURIComponent(parentTable.name)}&column=*`
        const res = await fetch(url)
        if (res.ok) {
          const { rows: parquetRows } = await res.json() as { rows: Record<string, unknown>[] }
          if (parquetRows && parquetRows.length > 0) {
            refData[parentTable.id] = parquetRows
            refData[parentTable.name] = parquetRows
          }
        }
      } catch {
        // Parquet not available
      }
    }
  }

  // Generate each column independently
  const columnResults: Record<string, unknown[]> = {}

  for (const col of table.columns) {
    columnResults[col.name] = await generateColumn(col, rowCount, refData, columnResults, table.columns)
  }

  // Assemble rows from column results
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, unknown> = {}
    for (const col of table.columns) {
      row[col.name] = columnResults[col.name]?.[i] ?? null
    }
    rows.push(row)
  }

  return rows
}

/**
 * Apply null ratio to generated column values.
 * Randomly replaces a percentage of non-null values with null.
 */
function applyNullRatio(col: ColumnDef, values: unknown[]): unknown[] {
  if (!col.nullable || !col.nullRatio || col.nullRatio <= 0) return values
  const ratio = Math.min(col.nullRatio, 100) / 100
  return values.map(v => (Math.random() < ratio ? null : v))
}

export async function generateColumn(
  col: ColumnDef,
  rowCount: number,
  refData: Record<string, Record<string, unknown>[]>,
  columnResults?: Record<string, unknown[]>,
  allCols?: ColumnDef[]
): Promise<unknown[]> {
  let results: unknown[] = []

  // Non-fk columns that reference another table: resolve values from refData/Parquet
  if (col.type !== 'foreign_key' && col.type !== 'foreign_key_array' && col.type !== 'date' && col.type !== 'number' && col.foreignTable) {
    for (let i = 0; i < rowCount; i++) {
      results.push(resolveForeignKey(col, refData))
    }
    return applyNullRatio(col, results)
  }

  switch (col.type) {
    case 'text':
      results = await generateTextColumn(col, rowCount)
      break

    case 'number':
      results = await generateNumberColumn(col, rowCount, refData, columnResults, allCols || [])
      break

    case 'date':
      results = await generateDateColumn(col, rowCount, refData, columnResults, allCols || [])
      break

    case 'boolean':
      if (col.generationCode?.trim()) {
        results = executeColumnCode(col, col.generationCode, rowCount, refData, columnResults, allCols || []).map(v => v == null ? null : (v ? 1 : 0))
      } else if (col.llmPrompt?.trim()) {
        const result = await llmGenerateCode(col.llmPrompt, 'boolean')
        if (result.code) {
          col.generationCode = result.code
          results = executeColumnCode(col, result.code, rowCount, refData, columnResults, allCols || []).map(v => v == null ? null : (v ? 1 : 0))
        } else if (result.error) {
          throw new Error(`Boolean column "${col.name}" 代码生成失败: ${result.error}`)
        } else {
          for (let i = 0; i < rowCount; i++) {
            results.push(generateBoolean(col.boolTrueRatio))
          }
        }
      } else {
        for (let i = 0; i < rowCount; i++) {
          results.push(generateBoolean(col.boolTrueRatio))
        }
      }
      break

    case 'foreign_key':
      for (let i = 0; i < rowCount; i++) {
        results.push(resolveForeignKey(col, refData))
      }
      break

    case 'foreign_key_array':
      for (let i = 0; i < rowCount; i++) {
        results.push(generateForeignKeyArray(col, refData))
      }
      break

    case 'id': {
      const format = col.idFormat || 'uuid4'
      const key = `${col.id}_${col.name}`
      resetAutoIncrement(key)
      for (let i = 0; i < rowCount; i++) {
        results.push(generateId(format, i, key))
      }
      break
    }

    case 'phone':
      for (let i = 0; i < rowCount; i++) {
        results.push(generatePhone(col.phoneCountry || 'CN'))
      }
      break

    case 'city':
      for (let i = 0; i < rowCount; i++) {
        results.push(generateCity(col.cityCountry || 'CN'))
      }
      break

    default:
      results = new Array(rowCount).fill(null)
  }

  return applyNullRatio(col, results)
}

// ──── Text column: LLM direct generation ────

async function generateTextColumn(col: ColumnDef, rowCount: number): Promise<string[]> {
  // Nullable with no prompt: skip LLM, generate nulls
  if (!col.llmPrompt?.trim()) {
    return new Array(rowCount).fill(null)
  }
  const prompts = Array.from({ length: rowCount }, (_, i) => `Item ${i + 1}: ${col.llmPrompt}`)
  try {
    const systemPrompt = `You are a synthetic data generator. Your task is to generate realistic, diverse data values.

Rules:
- Generate ONE value per item matching the description exactly
- Output only the raw value — no numbering, no prefix, no quotes, no markdown, no explanation
- Ensure diversity: avoid repeating the same value; vary names, numbers, phrases naturally
- Use authentic real-world patterns: real-sounding names, valid formats, natural language
- Match the locale and style implied by the description (Chinese names if specified, etc.)
- If the description implies a specific format, follow it precisely

Column description: ${col.llmPrompt}`
    const values = await callLlmBatch(systemPrompt, prompts)
    return values.map((value, i) => value ?? `[Error - Row ${i + 1}]`)
  } catch (err) {
    console.error(`[text] ${col.name} failed:`, err)
    return prompts.map((_, i) => `[Error - Row ${i + 1}]`)
  }
}

// ──── Number column: LLM generates code, then execute ────

async function generateNumberColumn(
  col: ColumnDef,
  rowCount: number,
  refData: Record<string, Record<string, unknown>[]>,
  columnResults?: Record<string, unknown[]>,
  allCols: ColumnDef[] = []
): Promise<unknown[]> {
  // If user provided code directly, use it
  if (col.generationCode?.trim()) {
    return executeColumnCode(col, col.generationCode, rowCount, refData, columnResults, allCols)
  }
  // Direct-value mode: imported number column copying a parent column value
  if (col.foreignTable && col.foreignColumn) {
    return Array.from({ length: rowCount }, () => resolveForeignKey(col, refData))
  }
  // If user provided prompt, ask LLM to generate code
  if (col.llmPrompt?.trim()) {
    const result = await llmGenerateCode(col.llmPrompt, 'number')
    if (result.code) {
      col.generationCode = result.code
      return executeColumnCode(col, result.code, rowCount, refData, columnResults, allCols)
    }
    // Surface the failure instead of silently falling back to random values
    if (result.error) {
      throw new Error(`Number column "${col.name}" 代码生成失败: ${result.error}`)
    }
  }
  // Fallback: random integers
  return Array.from({ length: rowCount }, () =>
    Math.floor(Math.random() * 100)
  )
}

// ──── Date column: LLM generates code, then execute ────

async function generateDateColumn(
  col: ColumnDef,
  rowCount: number,
  refData: Record<string, Record<string, unknown>[]>,
  columnResults?: Record<string, unknown[]>,
  allCols: ColumnDef[] = []
): Promise<unknown[]> {
  // If user selected a specific parent date column, use it directly
  if (col.parentDateColumn && col.foreignTable) {
    return executeColumnCode(col, `parentRow.${col.parentDateColumn}`, rowCount, refData, columnResults, allCols)
  }
  // If user provided code directly, use it
  if (col.generationCode?.trim()) {
    return executeColumnCode(col, col.generationCode, rowCount, refData, columnResults, allCols)
  }
  // Direct-value mode: imported date column copying a parent column value
  if (col.foreignTable && col.foreignColumn) {
    return Array.from({ length: rowCount }, () => resolveForeignKey(col, refData))
  }
  // If user provided prompt, ask LLM to generate code
  if (col.llmPrompt?.trim()) {
    const result = await llmGenerateCode(col.llmPrompt, 'date', { dateFormat: col.dateFormat, dateDistribution: col.dateDistribution })
    if (result.code) {
      col.generationCode = result.code
      return executeColumnCode(col, result.code, rowCount, refData, columnResults, allCols)
    }
    // Surface the failure instead of silently falling back to random dates
    if (result.error) {
      throw new Error(`Date column "${col.name}" 代码生成失败: ${result.error}`)
    }
  }
  // Fallback: use distribution if configured, else random dates
  const fmt = col.dateFormat || 'date'
  if (col.dateDistribution && col.dateDistribution.some(r => r.ratio > 0)) {
    return Array.from({ length: rowCount }, () => generateDateFromDistribution(col.dateDistribution!, fmt))
  }
  return Array.from({ length: rowCount }, () => generateDate(undefined, fmt))
}

// ──── LLM generates JavaScript code from a prompt ────

export async function llmGenerateCode(
  prompt: string,
  type: 'number' | 'date' | 'boolean',
  options?: { dateFormat?: string; dateDistribution?: DateRange[] }
): Promise<{ code: string | null; error?: string }> {
  // Build format instruction
  const DATE_FORMAT_DESC: Record<string, string> = {
    date: 'yyyy-MM-dd',
    datetime: 'yyyy-MM-dd HH:mm:ss',
    date_slash: 'yyyy/MM/dd',
    date_us: 'MM/dd/yyyy',
    date_eu: 'dd-MM-yyyy',
    time: 'HH:mm:ss',
    iso: 'ISO 8601',
    unix_s: 'Unix timestamp in seconds',
    unix_ms: 'Unix timestamp in milliseconds',
  }
  const DATE_FORMAT_CODE: Record<string, string> = {
    date: "formatDate(new Date(...),'date')",
    datetime: "formatDate(new Date(...),'datetime')",
    date_slash: "formatDate(new Date(...),'date_slash')",
    date_us: "formatDate(new Date(...),'date_us')",
    date_eu: "formatDate(new Date(...),'date_eu')",
    time: "formatDate(new Date(...),'time')",
    iso: "new Date(...).toISOString()",
    unix_s: "Math.floor(new Date(...).getTime()/1000)",
    unix_ms: "new Date(...).getTime()",
  }

  let formatInstruction = ''
  if (options?.dateFormat) {
    const desc = DATE_FORMAT_DESC[options.dateFormat] || options.dateFormat
    const code = DATE_FORMAT_CODE[options.dateFormat] || ''
    formatInstruction = `\nDATE FORMAT: ${desc}. Example output code pattern: ${code}`
  }

  let distributionInstruction = ''
  if (options?.dateDistribution && options.dateDistribution.some(r => r.ratio > 0)) {
    const ranges = options.dateDistribution
      .filter(r => r.ratio > 0)
      .map(r => `  "${r.label}" (${r.minDays}-${r.maxDays > 0 ? r.maxDays : r.minDays + 365} days ago): weight=${r.ratio}`)
      .join('\n')
    distributionInstruction = `\nDATE DISTRIBUTION (weighted random):\n${ranges}\nUse dateFromDistribution() to apply these configured weights and the selected output format. Do not reimplement the weighting logic.`
  }

  const systemPrompt = `You are a Nuwa generator-expression author. Respond with EXACTLY ONE LINE containing ONE side-effect-free expression and NOTHING ELSE — no words, no markdown, no explanation.

Available functions: randomInt(min,max) randomFloat(min,max) pick(array) formatDate(date,format) dateFromDistribution()
Available variables: index totalRows previousValues refData row parentRow
row = values from earlier columns in the same row, e.g. row.quantity
parentRow = the matching parent table row (auto-resolved via FK), e.g. parentRow.price — null if no FK match or no foreignTable set
Allowed syntax: literals, arrays, arithmetic/comparison/logical/ternary operators, property/index access, approved Math/String/Array/Date methods, and new Date(...).
Forbidden syntax: statements, const/let/var, assignments, function or arrow definitions, IIFEs, loops, object literals, regular expressions, and access to JavaScript globals.

EXAMPLES:
Input: "random age 18-65"
Output: randomInt(18,65)

Input: "price between 9.99 and 999.99"
Output: Math.round(randomFloat(9.99,999.99)*100)/100

Input: "total price = product price * quantity, FK to products table"
Output: parentRow.price * row.quantity

Input: "random date in last 30 days"
Output: formatDate(new Date(Date.now()-randomInt(0,30)*86400000),'date')

Input: "end date after start_date by 1-30 days"
Output: formatDate(new Date(new Date(row.start_date).getTime()+randomInt(1,30)*86400000),'date')

Input: "random date from another table's date range"
Output: formatDate(new Date(pick(refData.other_table).date_col),'date')

NOTE: row values are strings (from date columns) or numbers. Always wrap in new Date() before calling .getTime(). parentRow is null-safe — check before accessing fields. RefData contains rows from referenced tables keyed by table name.${formatInstruction}${distributionInstruction}

BOOLEAN COLUMN RULES (when type=boolean):
- Return 1 for true, 0 for false
- Example: "invert is_active" → row.is_active ? 0 : 1
- Example: "true if parent user is premium" → parentRow.is_premium ? 1 : 0
- Example: "true 30% of the time" → Math.random() < 0.3 ? 1 : 0
- Example: "deleted if status is expired" → row.status === 'expired' ? 1 : 0

Remember: ONE LINE ONLY. No backticks. No English words. Just the expression.`

  // Build cache key that includes format/distribution for correct cache matching
  const cacheKeyParts = [`${type}:${prompt.trim()}`]
  if (options?.dateFormat) cacheKeyParts.push(`fmt=${options.dateFormat}`)
  if (options?.dateDistribution) {
    const distKey = options.dateDistribution
      .filter(r => r.ratio > 0)
      .map(r => `${r.ratio}-${r.minDays}-${r.maxDays}`)
      .join(',')
    if (distKey) cacheKeyParts.push(`dist=${distKey}`)
  }
  const cacheKey = cacheKeyParts.join('|')

  let rawCode: string
  try {
    rawCode = await callLlm(systemPrompt, prompt, cacheKey)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { code: null, error: `API调用失败: ${msg}` }
  }

  if (!rawCode || !rawCode.trim()) {
    return { code: null, error: 'LLM返回为空' }
  }

  const result = extractExpression(rawCode)
  if (result.code) return result
  // Show the raw response in the error so the user can see what went wrong
  return { code: null, error: `${result.error} | 原始响应: ${rawCode.slice(0, 80)}` }
}

/** Try to extract a valid JS expression from raw LLM output. */
function extractExpression(raw: string): { code: string | null; error?: string } {
  // Step 1: unwrap markdown code blocks
  const text = raw.replace(/```(?:javascript|js)?\s*([\s\S]*?)```/g, '$1').trim()

  // Step 2: split into lines, filter out common natural-language prefixes
  const lines = text.split('\n').map(l =>
    l.replace(/^return\s+/i, '')
     .replace(/;\s*$/, '')
     .replace(/^(Here'?s?( is)?|The code|Output|Expression|Answer|Result):?\s*/i, '')
     .replace(/^\d+[\.\)]\s*/, '')  // numbered lists: "1. randomInt(...)"
     .trim()
  ).filter(Boolean)

  // Step 3: try each line as a candidate (longest JS-looking lines first)
  const candidates = lines
    .filter(l => l.length <= 350)
    .sort((a, b) => b.length - a.length)

  // Also try extracting from inline backticks
  const backtickMatch = raw.match(/`([^`]+)`/)
  if (backtickMatch) candidates.unshift(backtickMatch[1].trim())

  for (const candidate of candidates) {
    let evaluateExpression: ((context: Record<string, unknown>) => unknown) | null = null
    try {
      evaluateExpression = compileSafeExpression(candidate)
    } catch {
      continue
    }
    // Runtime test
    try {
      const testRefData: Record<string, unknown[]> = {
        users: [{ id: 1, name: 'test' }],
        orders: [{ id: 1 }],
        products: [{ id: 1 }],
      }
      const testPick = (arr: unknown[]) => (Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined)
      // Sample row: string-like values so row.name.length / .includes() /
      // .toUpperCase() work as they would against real string columns, while
      // row.xxx.getTime() still resolves via the attached helper.
      const testRow = new Proxy({} as Record<string, unknown>, {
        get: (_t, prop) => {
          if (prop === 'getTime') return undefined
          return Object.assign(new String('sample'), { getTime: () => 1700000000000 })
        },
        getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: 'sample' }),
      })
      const testParentRow = { id: 1, name: 'test', price: 100 }
      evaluateExpression({
        index: 0,
        totalRows: 1,
        previousValues: [],
        refData: testRefData,
        row: testRow,
        randomInt: (a: number) => a,
        randomFloat: (a: number) => a,
        pick: testPick,
        parentRow: testParentRow,
        formatDate,
        dateFromDistribution: () => formatDate(new Date(), 'date'),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // This candidate failed, try the next one
      if (candidates.length === 1) {
        return { code: null, error: `运行时错误: ${msg}` }
      }
      continue
    }
    return { code: candidate }
  }

  return { code: null, error: `未能提取有效表达式(共${candidates.length}个候选)` }
}

// ──── Execute code for each row ────

function executeColumnCode(
  col: ColumnDef,
  code: string,
  rowCount: number,
  refData: Record<string, Record<string, unknown>[]>,
  rowContext: Record<string, unknown[]> | undefined,
  allCols: ColumnDef[]
): unknown[] {
  // Basic validation before attempting compilation.
  // Reject natural-language output, but allow CJK characters inside quoted
  // string literals (e.g. row.status === '已过期').
  const codeOutsideStrings = code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '')
  if (!code || code.length > 500 || /[\u4e00-\u9fff]/.test(codeOutsideStrings)) {
    return new Array(rowCount).fill(null)
  }

  // Resolve FK column for parentRow lookup
  // Prefer explicit localMatchColumn, fallback to auto-detect FK column.
  // foreign_key_array is excluded: its value is a serialized "[1,2]" string
  // that can never match a single parent row.
  let fkColName: string | null = col.localMatchColumn || null
  let parentKeyCol = col.foreignColumn || 'id'
  if (!fkColName && col.foreignTable && allCols) {
    const fkCol = allCols.find(c =>
      c.type === 'foreign_key' &&
      c.foreignTable === col.foreignTable
    )
    if (fkCol) {
      fkColName = fkCol.name
      if (!col.foreignColumn) parentKeyCol = fkCol.foreignColumn || 'id'
    }
  }

  let evaluateExpression: ((context: Record<string, unknown>) => unknown) | null = null
  try {
    evaluateExpression = compileSafeExpression(code)
  } catch {
    return new Array(rowCount).fill(null)
  }

  const helpers = {
    randomInt: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
    randomFloat: (min: number, max: number) => Math.random() * (max - min) + min,
    pick: <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)],
    formatDate,
    dateFromDistribution: () => generateDateFromDistribution(
      col.dateDistribution || [],
      col.dateFormat || 'date'
    ),
  }

  const results: unknown[] = []
  for (let i = 0; i < rowCount; i++) {
    // Build row object from already-generated columns for this row index
    const row: Record<string, unknown> = rowContext
      ? Object.fromEntries(Object.entries(rowContext).map(([k, v]) => [k, v[i]]))
      : {}

    // Resolve parentRow for this row
    let parentRow: Record<string, unknown> | null = null
    if (fkColName && col.foreignTable) {
      const fkValue = row[fkColName]
      const parentRows = refData[col.foreignTable]
      if (parentRows && fkValue != null) {
        // String-normalized comparison: Parquet parent keys (e.g. id) are
        // often strings while generated FK values are numbers — strict ===
        // would never match and silently null every row.
        const normalized = String(fkValue)
        parentRow = parentRows.find(r => String(r[parentKeyCol]) === normalized) || null
      }
    }

    try {
      const val = evaluateExpression({
        index: i,
        totalRows: rowCount,
        previousValues: results,
        refData,
        row,
        randomInt: helpers.randomInt,
        randomFloat: helpers.randomFloat,
        pick: helpers.pick,
        parentRow,
        formatDate: helpers.formatDate,
        dateFromDistribution: helpers.dateFromDistribution,
      })
      results.push(val)
    } catch (err) {
      console.error(`[code exec] ${col.name} row ${i}:`, err)
      results.push(null)
    }
  }
  return results
}

// ──── Foreign key resolution ────

function resolveForeignKey(
  col: ColumnDef,
  refData: Record<string, Record<string, unknown>[]>
): unknown {
  if (!col.foreignTable) return null
  const parentRows = refData[col.foreignTable]
  if (!parentRows || parentRows.length === 0) return null
  const randomRow = parentRows[Math.floor(Math.random() * parentRows.length)]
  if (col.foreignColumn) {
    return randomRow[col.foreignColumn]
  }
  return randomRow['id'] || randomRow[Object.keys(randomRow)[0]]
}

// ──── Foreign key array: pick multiple values with normal-distributed count ────

/** Box-Muller normal random (mean 0, stddev 1) */
function normalRandom(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function generateForeignKeyArray(
  col: ColumnDef,
  refData: Record<string, Record<string, unknown>[]>
): string {
  if (!col.foreignTable) return '[]'
  const parentRows = refData[col.foreignTable]
  if (!parentRows || parentRows.length === 0) return '[]'

  const maxPick = Math.min(10, parentRows.length)
  // Normal distribution: mean=3, stddev=2, clamped to [1, maxPick]
  const raw = Math.round(3 + normalRandom() * 2)
  const count = Math.max(1, Math.min(maxPick, raw))

  // Pick `count` unique random indices
  const indices = new Set<number>()
  while (indices.size < count) {
    indices.add(Math.floor(Math.random() * parentRows.length))
  }

  const getValue = (row: Record<string, unknown>) => {
    if (col.foreignColumn) return row[col.foreignColumn]
    return row['id'] || row[Object.keys(row)[0]]
  }

  const values = Array.from(indices).map(i => {
    const val = getValue(parentRows[i])
    return String(val)
  })

  return `[${values.join(',')}]`
}
