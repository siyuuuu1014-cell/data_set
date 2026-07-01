import type { ColumnDef, TableDef } from './types'
import { callLlm, callLlmBatch } from './llm'
import { generateDate, generateBoolean, generateId, resetAutoIncrement, formatDate, generateDateFromDistribution, generatePhone, generateCity, type CodeGenContext } from './code-gen'

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
    columnResults[col.name] = await generateColumn(col, rowCount, refData)
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
  refData: Record<string, Record<string, unknown>[]>
): Promise<unknown[]> {
  let results: unknown[] = []

  // Non-fk columns that reference another table: resolve values from refData/Parquet
  if (col.type !== 'foreign_key' && col.foreignTable) {
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
      results = await generateNumberColumn(col, rowCount, refData)
      break

    case 'date':
      results = await generateDateColumn(col, rowCount, refData)
      break

    case 'boolean':
      for (let i = 0; i < rowCount; i++) {
        results.push(generateBoolean(col.generationCode))
      }
      break

    case 'foreign_key':
      for (let i = 0; i < rowCount; i++) {
        results.push(resolveForeignKey(col, refData))
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
    return await callLlmBatch(systemPrompt, prompts)
  } catch (err) {
    console.error(`[text] ${col.name} failed:`, err)
    return prompts.map((_, i) => `[Error - Row ${i + 1}]`)
  }
}

// ──── Number column: LLM generates code, then execute ────

async function generateNumberColumn(
  col: ColumnDef,
  rowCount: number,
  refData: Record<string, Record<string, unknown>[]>
): Promise<unknown[]> {
  // If user provided code directly, use it
  if (col.generationCode?.trim()) {
    return executeColumnCode(col, col.generationCode, rowCount, refData)
  }
  // If user provided prompt, ask LLM to generate code
  if (col.llmPrompt?.trim()) {
    const code = await llmGenerateCode(col.llmPrompt, 'number')
    if (code) {
      col.generationCode = code // cache the generated code
      return executeColumnCode(col, code, rowCount, refData)
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
  refData: Record<string, Record<string, unknown>[]>
): Promise<unknown[]> {
  // If user provided code directly, use it
  if (col.generationCode?.trim()) {
    return executeColumnCode(col, col.generationCode, rowCount, refData)
  }
  // If user provided prompt, ask LLM to generate code
  if (col.llmPrompt?.trim()) {
    const code = await llmGenerateCode(col.llmPrompt, 'date')
    if (code) {
      col.generationCode = code
      return executeColumnCode(col, code, rowCount, refData)
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

async function llmGenerateCode(prompt: string, type: 'number' | 'date'): Promise<string | null> {
  const systemPrompt = `You are a code generator. Write a SINGLE JavaScript expression that returns a ${type} value per row. Only respond with valid JavaScript — no Chinese, no natural language, no explanation.

Context variables available in scope:
  index          — current row index (0-based)
  totalRows      — total number of rows
  previousValues — array of already-generated values for this column
  refData        — object: refData["tableName"] is an array of row objects
  randomInt(min, max) — inclusive random integer
  randomFloat(min, max) — random float in [min, max)
  pick(arr)      — random element from an array

CRITICAL RULES:
- Output ONLY the raw expression. Nothing else. No markdown, no quotes, no explanation.
- NEVER write Chinese characters, never write natural language — only JavaScript.
- If you cannot express it as pure JavaScript, output a simple fallback like: randomInt(1, 100)

Examples:
"random age 18-65" → randomInt(18, 65)
"price 9.99-999.99" → Math.round(randomFloat(9.99, 999.99) * 100) / 100
"date in last 30 days" → new Date(Date.now() - randomInt(0, 30) * 86400000).toISOString().split('T')[0]
"sequential ID USR-0001" → 'USR-' + String(index + 1).padStart(4, '0')
"user name from users table" → pick(refData["users"]).name
"longitude in China" → randomFloat(73, 135).toFixed(6)`

  try {
    const code = await callLlm(systemPrompt, prompt)
    // Clean up response: extract code from markdown blocks, strip prefix/suffix noise
    let cleaned = code
      .replace(/```(?:javascript|js)?\s*([\s\S]*?)```/g, '$1') // unwrap code blocks
      .replace(/^return\s+/i, '')     // strip leading "return"
      .replace(/;\s*$/, '')           // strip trailing semicolon
      .trim()
    // If still contains backticks, try extracting inside
    const backtickMatch = cleaned.match(/`([^`]+)`/)
    if (backtickMatch) cleaned = backtickMatch[1]

    // Reject output that looks like natural language rather than JavaScript
    if (!cleaned || cleaned.length > 200) return null
    // Heuristic: if it contains CJK characters, it's probably not valid JS
    if (/[\u4e00-\u9fff]/.test(cleaned)) {
      return null
    }
    // Quick syntax check: try compiling
    try {
      new Function('index', 'totalRows', 'previousValues', 'refData', 'randomInt', 'randomFloat', 'pick',
        cleaned.includes('return ') ? cleaned : `return (${cleaned})`
      )
    } catch {
      return null
    }
    return cleaned
  } catch (err) {
    console.error(`[llm code-gen] ${type} failed:`, err)
    return null
  }
}

// ──── Execute code for each row ────

function executeColumnCode(
  col: ColumnDef,
  code: string,
  rowCount: number,
  refData: Record<string, Record<string, unknown>[]>
): unknown[] {
  // Compile the function once, outside the loop
  const expression = code.includes('return ') ? code : `return (${code})`
  let fn: ((...args: unknown[]) => unknown) | null = null
  try {
    fn = new Function(
      'index', 'totalRows', 'previousValues', 'refData',
      'randomInt', 'randomFloat', 'pick',
      expression
    ) as (...args: unknown[]) => unknown
  } catch (err) {
    console.error(`[code compile] ${col.name}:`, err)
    return new Array(rowCount).fill(null)
  }

  const helpers = {
    randomInt: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
    randomFloat: (min: number, max: number) => Math.random() * (max - min) + min,
    pick: <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)],
  }

  const results: unknown[] = []
  for (let i = 0; i < rowCount; i++) {
    try {
      const val = fn(
        i, rowCount, results, refData,
        helpers.randomInt, helpers.randomFloat, helpers.pick
      )
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
