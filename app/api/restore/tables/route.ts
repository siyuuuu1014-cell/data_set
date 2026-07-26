import { readdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

// GET /api/restore/tables — scan parquet files for a project (lightweight, no row reads)
export async function GET() {
  try {
    const dir = path.join(process.cwd(), 'generated_data', 'mr1h21v5')
    if (!existsSync(dir)) {
      return Response.json([])
    }

    const files = await readdir(dir)
    const tables = []

    for (const f of files) {
      if (!f.endsWith('.parquet')) continue
      const tableName = f.replace('.parquet', '')

      tables.push({
        id: tableName + '_0',
        name: tableName,
        columns: [],
        rowCount: 0,
        rows: [],
      })
    }

    return Response.json(tables)
  } catch {
    return Response.json([])
  }
}
