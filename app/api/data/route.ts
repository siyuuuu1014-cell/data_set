import { writeParquet, readParquet, countParquet, deleteParquetTable, deleteParquetProject, renameParquet, ParquetRenameConflictError } from '@/services/parquet'
import type { ColumnDef } from '@/services/types'
import { assertSafeFileStem, assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'

// GET ?projectId=X&tableName=Y — read Parquet data
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const tableName = searchParams.get('tableName')
  const countOnly = searchParams.get('count') === 'true'

  if (!projectId || !tableName) {
    return Response.json({ error: 'Missing params' }, { status: 400 })
  }

  try {
    assertSafeIdentifier(projectId, 'project ID')
    assertSafeFileStem(tableName, 'table name')
    if (countOnly) {
      const count = await countParquet(projectId, tableName)
      return Response.json({ count })
    }
    const rows = await readParquet(projectId, tableName)
    return Response.json({ rows })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: err.message }, { status: 400 })
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

    assertSafeIdentifier(projectId, 'project ID')
    assertSafeFileStem(tableName, 'table name')
    const path = await writeParquet(projectId, tableName, columns, rows)
    return Response.json({ ok: true, path })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: err.message }, { status: 400 })
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    console.error('[data POST]', msg)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// PATCH — rename a Parquet data file when a table is renamed
export async function PATCH(request: Request) {
  try {
    const { projectId, fromTable, toTable } = await request.json() as {
      projectId: string
      fromTable: string
      toTable: string
    }

    if (!projectId || !fromTable || !toTable) {
      return Response.json({ error: 'Missing params' }, { status: 400 })
    }

    assertSafeIdentifier(projectId, 'project ID')
    assertSafeFileStem(fromTable, 'table name')
    assertSafeFileStem(toTable, 'table name')
    const renamed = renameParquet(projectId, fromTable, toTable)
    if (!renamed) {
      return Response.json({ error: 'Source table has no generated data' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: err.message }, { status: 400 })
    if (err instanceof ParquetRenameConflictError) return Response.json({ error: err.message }, { status: 409 })
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    console.error('[data PATCH]', msg)
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
    assertSafeIdentifier(projectId, 'project ID')
    if (tableName) {
      assertSafeFileStem(tableName, 'table name')
      deleteParquetTable(projectId, tableName)
    } else {
      deleteParquetProject(projectId)
    }
    return Response.json({ ok: true })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: err.message }, { status: 400 })
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    console.error('[data DELETE]', msg)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
