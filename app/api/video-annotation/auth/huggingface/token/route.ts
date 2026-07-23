import type { NextRequest } from 'next/server'
import { deploymentMutationDenied } from '@/services/video-annotation/admin-access'
import { authorizeHuggingFaceToken } from '@/services/video-annotation/worker-client'

export async function POST(request: NextRequest) {
  const denied = deploymentMutationDenied(request)
  if (denied) return denied
  try {
    const payload = await request.json() as { token?: string }
    if (typeof payload.token !== 'string' || !payload.token.trim()) {
      return Response.json({ error: 'Hugging Face token is required' }, { status: 400 })
    }
    return Response.json(await authorizeHuggingFaceToken(payload.token))
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to authorize Hugging Face' },
      { status: 502 },
    )
  }
}
