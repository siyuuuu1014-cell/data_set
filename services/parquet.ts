/**
 * Server-side Parquet read/write using parquetjs.
 * Only used in API routes (server-side, not client).
 */

import { mkdirSync, existsSync, unlinkSync, rmdirSync, readdirSync } from 'fs'
import { join } from 'path'
import type { ColumnDef } from './types'

const parquet = require('parquetjs')

const DATA_DIR = join(process.cwd(), 'generated_data')

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function typeToParquet(colType: string): string {
  switch (colType) {
    case 'number': return 'DOUBLE'
    case 'boolean': return 'INT64'  // store 0/1 as int
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

/**
 * Write rows to a Parquet file.
 * Path: generated_data/{projectId}/{tableName}.parquet
 */
export async function writeParquet(
  projectId: string,
  tableName: string,
  columns: ColumnDef[],
  rows: Record<string, unknown>[]
): Promise<string> {
  const dir = join(DATA_DIR, projectId)
  ensureDir(dir)
  const filePath = join(dir, `${tableName}.parquet`)

  // Delete existing file first — avoid truncation issues with parquetjs
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
        // Convert booleans to 0/1
        if (col.type === 'boolean') {
          val = val ? 1 : 0
        }
        out[col.name] = val ?? null
      }
      await writer.appendRow(out)
    }

    await writer.close()
  } catch (err) {
    // Clean up partial file on failure
    try { await writer.close() } catch {}
    try { unlinkSync(filePath) } catch {}
    throw err
  }
  return filePath
}

/**
 * Read rows from a Parquet file.
 */
export async function readParquet(
  projectId: string,
  tableName: string
): Promise<Record<string, unknown>[]> {
  const filePath = join(DATA_DIR, projectId, `${tableName}.parquet`)
  if (!existsSync(filePath)) {
    return []
  }

  const reader = await parquet.ParquetReader.openFile(filePath)
  const cursor = reader.getCursor()
  const rows: Record<string, unknown>[] = []
  let row = null
  while ((row = await cursor.next())) {
    rows.push(row)
  }
  await reader.close()
  return rows
}

/**
 * Check if Parquet data exists for a table.
 */
export function parquetExists(projectId: string, tableName: string): boolean {
  return existsSync(join(DATA_DIR, projectId, `${tableName}.parquet`))
}

/**
 * Delete a single table's Parquet file.
 */
export function deleteParquetTable(projectId: string, tableName: string): void {
  const filePath = join(DATA_DIR, projectId, `${tableName}.parquet`)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
  // If the project directory is now empty, remove it too
  const dir = join(DATA_DIR, projectId)
  if (existsSync(dir)) {
    try {
      const remaining = readdirSync(dir)
      if (remaining.length === 0) {
        rmdirSync(dir)
      }
    } catch {
      // directory not empty or permissions issue — leave it
    }
  }
}

/**
 * Delete a project's entire data directory (all tables).
 */
export function deleteParquetProject(projectId: string): void {
  const dir = join(DATA_DIR, projectId)
  if (existsSync(dir)) {
    // Remove all files in the directory first, then the directory itself
    try {
      const files = readdirSync(dir)
      for (const f of files) {
        unlinkSync(join(dir, f))
      }
      rmdirSync(dir)
    } catch (err) {
      console.error(`[parquet] failed to delete project ${projectId}:`, err)
    }
  }
}
