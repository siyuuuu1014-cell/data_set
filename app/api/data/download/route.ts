import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// GET ?projectId=X&tableName=Y — download Parquet file
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const tableName = searchParams.get('tableName')

  if (!projectId || !tableName) {
    return Response.json({ error: 'Missing params' }, { status: 400 })
  }

  const dir = join(process.cwd(), 'generated_data', projectId)
  const filePath = join(dir, `${tableName}.parquet`)

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
