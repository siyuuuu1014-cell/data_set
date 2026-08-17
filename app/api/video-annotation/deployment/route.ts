import type { NextRequest } from 'next/server'
import { deploymentMutationDenied } from '@/services/video-annotation/admin-access'
import { updateWorkerDeployment, workerDeployment } from '@/services/video-annotation/worker-client'
import type { DeploymentMode } from '@/services/video-annotation/types'

export async function GET() {
  try {
    return Response.json(await workerDeployment())
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Worker not reachable' },
      { status: 503 },
    )
  }
}

export async function PUT(request: NextRequest) {
  const denied = deploymentMutationDenied(request)
  if (denied) return denied
  try {
    const payload = await request.json() as { mode?: DeploymentMode }
    if (payload.mode !== 'standard' && payload.mode !== 'enhanced') {
      return Response.json({ error: 'Invalid deployment mode' }, { status: 400 })
    }
    return Response.json(await updateWorkerDeployment(payload.mode))
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to update deployment mode' },
      { status: 502 },
    )
  }
}
