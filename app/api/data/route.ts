import { writeParquet, readParquet, deleteParquetTable, deleteParquetProject } from '@/services/parquet'
import type { ColumnDef } from '@/services/types'

// GET ?projectId=X&tableName=Y — read Parquet data
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const tableName = searchParams.get('tableName')

  if (!projectId || !tableName) {
    return Response.json({ error: 'Missing params' }, { status: 400 })
  }

  try {
    const rows = await readParquet(projectId, tableName)
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    console.error('[data GET]', msg)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// POST — write generated data to Parquet
export async function POST(request: Request) {
  try {
    const { projectId, tableName, columns, rows } = await request.json() as {
      projectId: string
      tableName: string
      columns: ColumnDef[]
      rows: Record<string, unknown>[]
    }

    if (!projectId || !tableName || !columns || !rows) {
      return Response.json({ error: 'Missing data' }, { status: 400 })
    }

    const path = await writeParquet(projectId, tableName, columns, rows)
    return Response.json({ ok: true, path })
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    console.error('[data POST]', msg)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// DELETE ?projectId=X&tableName=Y — delete Parquet data
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const tableName = searchParams.get('tableName')

  if (!projectId) {
    return Response.json({ error: 'Missing projectId' }, { status: 400 })
  }

  try {
    if (tableName) {
      deleteParquetTable(projectId, tableName)
    } else {
      deleteParquetProject(projectId)
    }
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    console.error('[data DELETE]', msg)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
