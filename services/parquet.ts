/**
 * Server-side Parquet read/write using parquetjs.
 * Falls back to Python (pandas) for files written by pyarrow/pandas.
 * Only used in API routes (server-side, not client).
 */

import { mkdirSync, existsSync, unlinkSync, rmdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import type { ColumnDef } from './types'
import { assertSafeFileStem, assertSafeIdentifier, resolveWithin } from './server-paths'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const parquet = require('parquetjs')

const DATA_DIR = join(process.cwd(), 'generated_data')

function getProjectDir(projectId: string): string {
  assertSafeIdentifier(projectId, 'project ID')
  return resolveWithin(DATA_DIR, projectId)
}

function getParquetPath(projectId: string, tableName: string): string {
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
  try {
    const python = process.platform === 'win32' ? 'python' : 'python3'
    const script = "import pandas as pd,json,sys; df=pd.read_parquet(sys.argv[1]); print(json.dumps(df.where(pd.notna(df),None).to_dict(orient='records'), default=str))"
    const output = execFileSync(python, ['-c', script, filePath], {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    })
    return JSON.parse(output) as Record<string, unknown>[]
  } catch (e) {
    console.error('[parquet] Python fallback failed:', e)
    return []
  }
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

  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }

  const schema = new parquet.ParquetSchema(buildParquetSchema(columns))
  const writer = await parquet.ParquetWriter.openFile(schema, filePath)

  try {
    for (const row of rows) {
      const out: Record<string, unknown> = {}
      for (const col of columns) {
        let val = row[col.name]
        if (col.type === 'boolean') val = val ? 1 : 0
        if (col.type === 'number') {
          if (typeof val === 'string') { const num = Number(val); val = isNaN(num) ? null : num }
          else if (typeof val !== 'number' && val !== null && val !== undefined) { const num = Number(val); val = isNaN(num) ? null : num }
        }
        out[col.name] = val ?? null
      }
      await writer.appendRow(out)
    }
    await writer.close()
  } catch (err) {
    try { await writer.close() } catch {}
    try { unlinkSync(filePath) } catch {}
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
  try {
    const reader = await parquet.ParquetReader.openFile(filePath)
    const cursor = reader.getCursor()
    const rows: Record<string, unknown>[] = []
    let row = null
    while ((row = await cursor.next())) rows.push(row)
    await reader.close()
    if (rows.length > 0 && Object.keys(rows[0]).length > 0) return rows
    // Empty objects — file was written by pandas/pyarrow, fall through to Python
  } catch {
    // parquetjs failed completely — fall through to Python
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
