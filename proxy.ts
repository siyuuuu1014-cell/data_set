import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let mismatch = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return mismatch === 0
}

function hasValidBasicAuth(request: NextRequest, user: string, password: string): boolean {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Basic ')) return false
  try {
    const raw = atob(authorization.slice(6))
    const decoded = new TextDecoder().decode(Uint8Array.from(raw, char => char.charCodeAt(0)))
    const separator = decoded.indexOf(':')
    if (separator < 0) return false
    return constantTimeEqual(decoded.slice(0, separator), user) &&
      constantTimeEqual(decoded.slice(separator + 1), password)
  } catch {
    return false
  }
}

function errorResponse(request: NextRequest, message: string, status: number, authenticate = false): NextResponse {
  const response = request.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: message }, { status })
    : new NextResponse(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  if (authenticate) response.headers.set('WWW-Authenticate', 'Basic realm="Nuwa", charset="UTF-8"')
  return response
}

function isCrossSiteMutation(request: NextRequest): boolean {
  if (!request.nextUrl.pathname.startsWith('/api/')) return false
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return false
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true

  const origin = request.headers.get('origin')
  if (!origin || origin === 'null') return false
  try {
    // Never trust x-forwarded-host: it is client-controllable without a
    // reverse proxy and would let an attacker spoof a same-site origin.
    const requestHost = request.headers.get('host')
    if (!requestHost) return new URL(origin).origin !== request.nextUrl.origin
    return new URL(origin).host.toLowerCase() !== requestHost.toLowerCase()
  } catch {
    return true
  }
}

export function proxy(request: NextRequest): NextResponse {
  const user = process.env.NUWA_AUTH_USER || ''
  const password = process.env.NUWA_AUTH_PASSWORD || ''

  if ((user && !password) || (!user && password)) {
    return errorResponse(request, 'NUWA_AUTH_USER 和 NUWA_AUTH_PASSWORD 必须同时配置', 503)
  }
  if (user && password && !hasValidBasicAuth(request, user, password)) {
    return errorResponse(request, '需要身份验证', 401, true)
  }
  if (isCrossSiteMutation(request)) {
    return errorResponse(request, '拒绝跨站修改请求', 403)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|favicon.ico).*)'],
}
