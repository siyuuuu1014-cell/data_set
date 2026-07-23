import type { NextRequest } from 'next/server'

function requestHostname(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0].trim()
  const host = forwarded || request.headers.get('host') || request.nextUrl.host
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']'))
  return host.split(':')[0].toLowerCase()
}

export function deploymentMutationDenied(request: NextRequest): Response | null {
  if (process.env.NUWA_AUTH_USER && process.env.NUWA_AUTH_PASSWORD) return null
  const hostname = requestHostname(request)
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return null
  return Response.json(
    { error: 'Remote model administration requires NUWA_AUTH_USER and NUWA_AUTH_PASSWORD' },
    { status: 403 },
  )
}
