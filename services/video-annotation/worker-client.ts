/** HTTP client for the Python annotation worker. */

import { WORKER_URL } from './constants'
import type {
  DeploymentMode,
  DeploymentStatus,
  WorkerJobStatus,
  WorkerHealth,
} from './types'

const workerUrl = process.env.VIDEO_ANNOTATION_WORKER_URL || WORKER_URL

function adminHeaders(): HeadersInit {
  const token = process.env.NUWA_WORKER_ADMIN_TOKEN
  return token ? { 'X-Nuwa-Worker-Admin': token } : {}
}

async function workerJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${workerUrl}${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...init?.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail || `Worker returned ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function workerHealth(): Promise<WorkerHealth> {
  const res = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(5000) })
  return res.json() as Promise<WorkerHealth>
}

export async function submitJob(payload: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${workerUrl}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    throw new Error(`Worker returned ${res.status}`)
  }
  const data = await res.json() as { jobId: string }
  return data.jobId
}

export async function getJobStatus(jobId: string): Promise<WorkerJobStatus> {
  const res = await fetch(`${workerUrl}/jobs/${encodeURIComponent(jobId)}`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    const error = res.status === 404
      ? 'Worker job not found (HTTP 404). The saved job ID is stale; retry this segment.'
      : `Worker job status request failed (HTTP ${res.status})`
    return { jobId, status: 'failed', progress: 0, result: null, error }
  }
  return res.json() as Promise<WorkerJobStatus>
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const res = await fetch(`${workerUrl}/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
  })
  return res.ok
}

export function workerDeployment(): Promise<DeploymentStatus> {
  return workerJson<DeploymentStatus>('/deployment')
}

export function updateWorkerDeployment(mode: DeploymentMode): Promise<DeploymentStatus> {
  return workerJson<DeploymentStatus>('/deployment', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
}

export function authorizeHuggingFaceToken(token: string): Promise<{ authenticated: true; username: string | null }> {
  return workerJson<{ authenticated: true; username: string | null }>('/auth/huggingface/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

export function prepareEnhancedDeployment(): Promise<DeploymentStatus['enhancedSetup']> {
  return workerJson<DeploymentStatus['enhancedSetup']>('/deployment/prepare', { method: 'POST' })
}
