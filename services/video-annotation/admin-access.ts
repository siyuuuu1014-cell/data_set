import type { NextRequest } from 'next/server'

function requestHostname(request: NextRequest): string {
  // Never trust X-Forwarded-Host: it is client-controllable and can be spoofed
  // to bypass the local-only admin guard on deployments without a reverse proxy.
  const host = request.headers.get('host') || request.nextUrl.host
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']'))
  return host.split(':')[0].toLowerCase()
}

/** Loopback or RFC1918 private address (LAN deployments are trusted). */
function isTrustedHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true
  // IPv4 private ranges: 10/8, 172.16/12, 192.168/16
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!match) return false
  const [a, b] = [Number(match[1]), Number(match[2])]
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function deploymentMutationDenied(request: NextRequest): Response | null {
  if (process.env.NUWA_AUTH_USER && process.env.NUWA_AUTH_PASSWORD) return null
  const hostname = requestHostname(request)
  if (isTrustedHostname(hostname)) return null
  return Response.json(
    { error: 'Remote model administration requires NUWA_AUTH_USER and NUWA_AUTH_PASSWORD' },
    { status: 403 },
  )
}
