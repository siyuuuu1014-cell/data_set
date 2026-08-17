import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class UnsafeLlmUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeLlmUrlError'
  }
}

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

function allowedPrivateHosts(): Set<string> {
  return new Set(
    (process.env.NUWA_LLM_ALLOWED_PRIVATE_HOSTS || '')
      .split(',')
      .map(host => normalizedHostname(host.trim()))
      .filter(Boolean)
  )
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const numbers = parts.map(Number)
  if (numbers.some((part, index) => !/^\d+$/.test(parts[index]) || part < 0 || part > 255)) return null
  return numbers
}

function embeddedIpv4(address: string): string | null {
  const dotted = address.toLowerCase().match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (dotted && parseIpv4(dotted[1])) return dotted[1]

  const hex = address.toLowerCase().match(/^(?:::ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex) return null
  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

function isLoopbackAddress(address: string): boolean {
  const normalized = normalizedHostname(address)
  if (normalized === '::1') return true
  const ipv4 = parseIpv4(normalized) || parseIpv4(embeddedIpv4(normalized) || '')
  return !!ipv4 && ipv4[0] === 127
}

function isNonPublicIpv4(address: string): boolean {
  const parts = parseIpv4(address)
  if (!parts) return true
  const [a, b, c] = parts
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function isNonPublicIpv6(address: string): boolean {
  const normalized = normalizedHostname(address)
  const mapped = embeddedIpv4(normalized)
  if (mapped) return isNonPublicIpv4(mapped)
  if (normalized === '::' || normalized === '::1') return true

  const parts = normalized.split(':')
  const first = Number.parseInt(parts[0] || '0', 16)
  // Only globally routable 2000::/3 addresses are accepted by default.
  if ((first & 0xe000) !== 0x2000) return true
  const second = Number.parseInt(parts[1] || '0', 16)
  if (first === 0x2001 && second < 0x0200) return true // IETF protocol assignments
  if (normalized.startsWith('2001:db8:') || normalized === '2001:db8::') return true
  if (first === 0x2002) return true // 6to4 can embed a non-public IPv4 target
  if (first === 0x3fff && second < 0x1000) return true // documentation range
  return false
}

export function isNonPublicAddress(address: string): boolean {
  const normalized = normalizedHostname(address)
  const version = isIP(normalized)
  if (version === 4) return isNonPublicIpv4(normalized)
  if (version === 6) return isNonPublicIpv6(normalized)
  return true
}

export function validateLlmBaseUrl(value: string): URL {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new UnsafeLlmUrlError('Base URL 无效')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new UnsafeLlmUrlError('Base URL 必须是有效的 http:// 或 https:// 地址')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeLlmUrlError('Base URL 仅支持 http:// 或 https://')
  }
  if (url.username || url.password) {
    throw new UnsafeLlmUrlError('Base URL 不能包含用户名或密码')
  }

  const hostname = normalizedHostname(url.hostname)
  const explicitlyAllowed = allowedPrivateHosts().has(hostname)
  if (isIP(hostname) && isNonPublicAddress(hostname) && !isLoopbackAddress(hostname) && !explicitlyAllowed) {
    throw new UnsafeLlmUrlError('Base URL 指向内网或保留地址；如确需使用，请配置 NUWA_LLM_ALLOWED_PRIVATE_HOSTS')
  }
  return url
}

export async function assertSafeLlmRequestUrl(value: string): Promise<void> {
  const url = validateLlmBaseUrl(value)
  const hostname = normalizedHostname(url.hostname)
  if (hostname === 'localhost' || isLoopbackAddress(hostname) || allowedPrivateHosts().has(hostname)) return
  if (isIP(hostname)) return

  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new UnsafeLlmUrlError(`无法解析 LLM 服务地址: ${hostname}`)
  }
  if (addresses.length === 0 || addresses.some(result => isNonPublicAddress(result.address))) {
    throw new UnsafeLlmUrlError('LLM 服务域名解析到了内网或保留地址；如确需使用，请配置 NUWA_LLM_ALLOWED_PRIVATE_HOSTS')
  }
}
