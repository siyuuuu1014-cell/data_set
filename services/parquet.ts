/**
 * Server-side Parquet read/write using parquetjs.
 * Falls back to Python (pandas) for files written by pyarrow/pandas.
 * Only used in API routes (server-side, not client).
 */

import { mkdirSync, existsSync, unlinkSync, rmdirSync, readdirSync, renameSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import type { ColumnDef } from './types'
import { assertSafeFileStem, assertSafeIdentifier, resolveWithin } from './server-paths'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const parquet = require('parquetjs')

// Data root is resolved per call (not at module load) so tests can redirect it
// via NUWA_DATA_DIR to a temporary directory instead of writing into the
// repository's generated_data/.
function dataDir(): string {
  return process.env.NUWA_DATA_DIR || join(process.cwd(), 'generated_data')
}

function getProjectDir(projectId: string): string {
  assertSafeIdentifier(projectId, 'project ID')
  return resolveWithin(dataDir(), projectId)
}

/** Resolve the on-disk path for a table's Parquet file (single data-root source). */
export function getParquetPath(projectId: string, tableName: string): string {
  assertSafeFileStem(tableName, 'table name')
  return resolveWithin(getProjectDir(projectId), `${tableName}.parquet`)
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function typeToParquet(colType: string): string {
  switch (colType) {
    case 'number': return 'DOUBLE'
    case 'boolean': return 'INT64'
    case 'date': return 'UTF8'
    case 'foreign_key':
    case 'foreign_key_array': return 'UTF8'
    default: return 'UTF8'
  }
}

function buildParquetSchema(columns: ColumnDef[]): Record<string, { type: string; optional?: boolean }> {
  const schema: Record<string, { type: string; optional?: boolean }> = {}
  for (const col of columns) {
    schema[col.name] = { type: typeToParquet(col.type), optional: true }
  }
  return schema
}

export async function readParquetViaPython(filePath: string): Promise<Record<string, unknown>[]> {
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const script = "import pandas as pd,json,sys; df=pd.read_parquet(sys.argv[1]); print(json.dumps(df.where(pd.notna(df),None).to_dict(orient='records'), default=str))"
  const output = execFileSync(python, ['-c', script, filePath], {
    encoding: 'utf-8',
    timeout: 30000,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  })
  return JSON.parse(output) as Record<string, unknown>[]
}

export async function writeParquet(
  projectId: string,
  tableName: string,
  columns: ColumnDef[],
  rows: Record<string, unknown>[]
): Promise<string> {
const dir = getProjectDir(projectId)
  ensureDir(dir)
  const filePath = getParquetPath(projectId, tableName)
  const tmpPath = `${filePath}.tmp`

  const schema = new parquet.ParquetSchema(buildParquetSchema(columns))
  const writer = await parquet.ParquetWriter.openFile(schema, tmpPath)

  try {
    // Pre-convert every row synchronously (types/null normalization) so the
    // async write loop below only awaits the append itself.
    const converted: Record<string, unknown>[] = []
    for (const row of rows) {
      const out: Record<string, unknown> = {}
      for (const col of columns) {
        let val = row[col.name]
        if (col.type === 'boolean' && val != null) val = val ? 1 : 0
        if (col.type === 'number') {
          if (typeof val === 'string') { const num = Number(val); val = isNaN(num) ? null : num }
          else if (typeof val !== 'number' && val !== null && val !== undefined) { const num = Number(val); val = isNaN(num) ? null : num }
        }
        out[col.name] = val ?? null
      }
      converted.push(out)
    }
    for (const out of converted) {
      await writer.appendRow(out)
    }
    await writer.close()
    ensureDir(dir)
    renameSync(tmpPath, filePath)
  } catch (err) {
    try { await writer.close() } catch {}
    try { unlinkSync(tmpPath) } catch {}
    throw err
  }
  return filePath
}

export async function readParquet(
  projectId: string,
  tableName: string
): Promise<Record<string, unknown>[]> {
  const filePath = getParquetPath(projectId, tableName)
  if (!existsSync(filePath)) return []

  // Try parquetjs first, fall back to Python for externally-written files
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reader: any = null
  try {
    reader = await parquet.ParquetReader.openFile(filePath)
    const cursor = reader.getCursor()
    const rows: Record<string, unknown>[] = []
    let row = null
    while ((row = await cursor.next())) rows.push(row)
    if (rows.length > 0 && Object.keys(rows[0]).length > 0) {
      // parquetjs omits null-valued keys entirely — restore them as null so
      // consumers get a stable schema shape
      const allKeys = new Set<string>()
      for (const r of rows) for (const key of Object.keys(r)) allKeys.add(key)
      for (const r of rows) {
        for (const key of allKeys) {
          if (r[key] === undefined) r[key] = null
        }
      }
      return rows
    }
    // Empty objects — file was written by pandas/pyarrow, fall through to Python
  } catch {
    // parquetjs failed completely — fall through to Python
  } finally {
    try { await reader?.close() } catch {}
  }
  return readParquetViaPython(filePath)
}

export async function countParquet(projectId: string, tableName: string): Promise<number> {
  const rows = await readParquet(projectId, tableName)
  return rows.length
}

export function parquetExists(projectId: string, tableName: string): boolean {
  return existsSync(getParquetPath(projectId, tableName))
}

export class ParquetRenameConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParquetRenameConflictError'
  }
}

export function renameParquet(projectId: string, fromName: string, toName: string): boolean {
  const fromPath = getParquetPath(projectId, fromName)
  const toPath = getParquetPath(projectId, toName)
  if (!existsSync(fromPath)) return false
  if (existsSync(toPath)) {
    throw new ParquetRenameConflictError(`表名 "${toName}" 已存在，无法重命名`)
  }
  renameSync(fromPath, toPath)
  return true
}

export function deleteParquetTable(projectId: string, tableName: string): void {
  const filePath = getParquetPath(projectId, tableName)
  if (existsSync(filePath)) unlinkSync(filePath)
  const dir = getProjectDir(projectId)
  if (existsSync(dir)) {
    try { if (readdirSync(dir).length === 0) rmdirSync(dir) } catch {}
  }
}

export function deleteParquetProject(projectId: string): void {
  const dir = getProjectDir(projectId)
  if (existsSync(dir)) {
    try {
      for (const f of readdirSync(dir)) unlinkSync(join(dir, f))
      rmdirSync(dir)
    } catch (err) { console.error(`[parquet] failed to delete project ${projectId}:`, err) }
  }
}
