import { workerHealth } from '@/services/video-annotation/worker-client'

export async function GET() {
  try {
    const health = await workerHealth()
    return Response.json(health)
  } catch {
    return Response.json({ status: 'unavailable', error: 'Worker not reachable' }, { status: 503 })
  }
}
