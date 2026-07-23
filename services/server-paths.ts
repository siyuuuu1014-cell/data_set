import path from 'path'

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const INVALID_FILE_STEM_CHARS = /[<>:"/\\|?*\u0000-\u001f]/

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafePathError'
  }
}

export function assertSafeIdentifier(value: unknown, label = 'id'): asserts value is string {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new UnsafePathError(`Invalid ${label}`)
  }
}

/**
 * Validate a user-visible name that is used as one filesystem path segment.
 * Unicode and spaces are allowed, but separators, control characters, Windows
 * device names, and ambiguous trailing characters are not.
 */
export function assertSafeFileStem(value: unknown, label = 'file name'): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 180) {
    throw new UnsafePathError(`Invalid ${label}`)
  }
  if (value !== value.trim() || value === '.' || value === '..') {
    throw new UnsafePathError(`Invalid ${label}`)
  }
  if (INVALID_FILE_STEM_CHARS.test(value) || value.endsWith('.') || WINDOWS_RESERVED_NAME.test(value)) {
    throw new UnsafePathError(`Invalid ${label}`)
  }
}

/** Resolve a path and prove that it remains inside the supplied root. */
export function resolveWithin(root: string, ...segments: string[]): string {
  const absoluteRoot = path.resolve(root)
  const target = path.resolve(absoluteRoot, ...segments)
  const relative = path.relative(absoluteRoot, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new UnsafePathError('Resolved path escapes its data directory')
  }
  return target
}

export function isUnsafePathError(error: unknown): error is UnsafePathError {
  return error instanceof UnsafePathError
}
