import type { NextRequest } from 'next/server'
import { deploymentMutationDenied } from '@/services/video-annotation/admin-access'
import { prepareEnhancedDeployment } from '@/services/video-annotation/worker-client'

export async function POST(request: NextRequest) {
  const denied = deploymentMutationDenied(request)
  if (denied) return denied
  try {
    return Response.json(await prepareEnhancedDeployment())
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to prepare enhanced mode' },
      { status: 502 },
    )
  }
}
