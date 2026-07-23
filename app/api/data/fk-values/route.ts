import { readParquet } from '@/services/parquet'
import { assertSafeFileStem, assertSafeIdentifier, isUnsafePathError } from '@/services/server-paths'

// GET ?projectId=X&tableId=Y&column=Z — read column values from Parquet
// column=* returns full rows; column=name returns just that column's values
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const tableId = searchParams.get('tableId')
  const column = searchParams.get('column')

  if (!projectId || !tableId || !column) {
    return Response.json({ error: 'Missing params' }, { status: 400 })
  }

  try {
    assertSafeIdentifier(projectId, 'project ID')
    assertSafeFileStem(tableId, 'table name')
    const rows = await readParquet(projectId, tableId)
    if (column === '*') {
      return Response.json({ rows })
    }
    const values = rows.map(row => row[column]).filter(v => v !== null && v !== undefined)
    return Response.json({ values })
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: err.message }, { status: 400 })
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
