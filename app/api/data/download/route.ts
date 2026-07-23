import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { assertSafeFileStem, assertSafeIdentifier, isUnsafePathError, resolveWithin } from '@/services/server-paths'

// GET ?projectId=X&tableName=Y — download Parquet file
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const tableName = searchParams.get('tableName')

  if (!projectId || !tableName) {
    return Response.json({ error: 'Missing params' }, { status: 400 })
  }

  let filePath: string
  try {
    assertSafeIdentifier(projectId, 'project ID')
    assertSafeFileStem(tableName, 'table name')
    const dataRoot = join(process.cwd(), 'generated_data')
    const dir = resolveWithin(dataRoot, projectId)
    filePath = resolveWithin(dir, `${tableName}.parquet`)
  } catch (err) {
    if (isUnsafePathError(err)) return Response.json({ error: err.message }, { status: 400 })
    throw err
  }

  if (!existsSync(filePath)) {
    return Response.json({ error: 'Parquet file not found' }, { status: 404 })
  }

  const buffer = readFileSync(filePath)
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${tableName}.parquet"`,
    },
  })
}
