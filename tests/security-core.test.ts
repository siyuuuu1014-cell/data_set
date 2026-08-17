import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { evaluateSafeExpression, isSafeExpression } from '../services/safe-expression'
import { withTaskFileLock, writeTaskFileAtomic } from '../services/video-annotation/task-file-lock'

// ── Safe expression: rejection & semantics ──

test('safe expression rejects prototype-chain and global access', () => {
  const forbidden = [
    'row.__proto__',
    'row["__proto__"]',
    'row.constructor',
    'row["constructor"]',
    'this',
    'eval(1)',
    'process',
    'globalThis',
    'global',
    'require("fs")',
    'function f() {}',
    'const x = 1',
    'let y = 2',
    'x = 3',
    'for(;;){}',
    'while(true){}',
    '() => 1',
    'new Function("x")',
  ]
  for (const source of forbidden) {
    assert.equal(isSafeExpression(source), false, `should reject: ${source}`)
  }
})

test('safe expression handles common generator expressions', () => {
  const context = {
    index: 0, totalRows: 10, previousValues: [],
    refData: {},
    row: { name: '张三', status: 'active', quantity: 3 },
    parentRow: { price: 99, id: 'p1' },
    randomInt: (a: number, b: number) => Math.floor((a + b) / 2),
    randomFloat: (a: number) => a,
    pick: (arr: unknown[]) => arr[0],
    formatDate: (d: Date) => d.toISOString(),
    dateFromDistribution: () => '2024-01-01',
  }
  assert.equal(evaluateSafeExpression('row.name', context), '张三')
  assert.equal(evaluateSafeExpression('row.status === "active" ? 1 : 0', context), 1)
  assert.equal(evaluateSafeExpression('parentRow.price * 2', context), 198)
  assert.equal(evaluateSafeExpression('parentRow.id', context), 'p1')
  assert.equal(evaluateSafeExpression('randomInt(1, 10)', context), 5)
  assert.equal(evaluateSafeExpression('row.quantity > 2 ? "big" : "small"', context), 'big')
  assert.equal(evaluateSafeExpression('new Date("2024-01-01").getFullYear()', context), 2024)
})

test('safe expression rejects deep nesting and oversized sources', () => {
  const deep = '('.repeat(60) + '1' + ')'.repeat(60)
  assert.equal(isSafeExpression(deep), false, 'deep nesting must be rejected')
  const long = '1 + ' + '1 + '.repeat(500) + '1'
  assert.equal(isSafeExpression(long), false, 'oversized source must be rejected')
})

// ── Task file lock: serialization, error release, atomic write ──

test('withTaskFileLock serializes concurrent actions and releases on error', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nuwa-lock-'))
  const file = path.join(root, 'task.json')
  await writeFile(file, '0')

  const order: string[] = []
  const first = withTaskFileLock(file, async () => {
    order.push('a-start')
    await new Promise(resolve => setTimeout(resolve, 30))
    order.push('a-end')
  })
  const second = withTaskFileLock(file, async () => {
    order.push('b')
  })
  await Promise.all([first, second])
  assert.deepEqual(order, ['a-start', 'a-end', 'b'], 'actions must not interleave')

  // A throwing action must release the lock for the next caller.
  await assert.rejects(
    withTaskFileLock(file, async () => { throw new Error('boom') }),
    /boom/,
  )
  let ran = false
  await withTaskFileLock(file, async () => { ran = true })
  assert.equal(ran, true, 'lock must be reusable after an error')
  await rm(root, { recursive: true, force: true })
})

test('writeTaskFileAtomic replaces content and cleans tmp on failure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nuwa-atomic-'))
  const file = path.join(root, 'task.json')
  await writeTaskFileAtomic(file, '{"a":1}')
  assert.equal(await readFile(file, 'utf-8'), '{"a":1}')
  assert.equal(existsSync(`${file}.tmp`), false, 'tmp must not linger after success')
  await rm(root, { recursive: true, force: true })
})

// ── Proxy middleware: auth + CSRF ──

// The middleware reads process.env at request time, so each case sets and
// restores the env around a single invocation.
async function withEnv(user: string | undefined, password: string | undefined, run: () => Promise<void>) {
  const prevUser = process.env.NUWA_AUTH_USER
  const prevPassword = process.env.NUWA_AUTH_PASSWORD
  if (user === undefined) delete process.env.NUWA_AUTH_USER
  else process.env.NUWA_AUTH_USER = user
  if (password === undefined) delete process.env.NUWA_AUTH_PASSWORD
  else process.env.NUWA_AUTH_PASSWORD = password
  try { await run() } finally {
    if (prevUser === undefined) delete process.env.NUWA_AUTH_USER
    else process.env.NUWA_AUTH_USER = prevUser
    if (prevPassword === undefined) delete process.env.NUWA_AUTH_PASSWORD
    else process.env.NUWA_AUTH_PASSWORD = prevPassword
  }
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf-8').toString('base64')}`
}

test('proxy middleware enforces basic auth when configured', async () => {
  await withEnv('admin', 'secret', async () => {
    const { proxy } = await import('../proxy')
    const { NextRequest } = await import('next/server')

    // No credentials → 401 with WWW-Authenticate
    const noAuth = new NextRequest('http://localhost:3000/api/data?projectId=x&tableName=y', {
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    })
    const denied = proxy(noAuth)
    assert.equal(denied.status, 401)
    assert.ok(denied.headers.get('www-authenticate')?.includes('Basic'))

    // Wrong credentials → 401
    const wrong = new NextRequest('http://localhost:3000/api/data', {
      headers: { authorization: basicAuth('admin', 'wrong'), host: 'localhost:3000', origin: 'http://localhost:3000' },
    })
    assert.equal(proxy(wrong).status, 401)

    // Correct credentials → pass
    const ok = new NextRequest('http://localhost:3000/api/data', {
      headers: { authorization: basicAuth('admin', 'secret'), host: 'localhost:3000', origin: 'http://localhost:3000' },
    })
    assert.equal(proxy(ok).status, 200)
  })
})

test('proxy middleware rejects cross-site mutations', async () => {
  await withEnv(undefined, undefined, async () => {
    const { proxy } = await import('../proxy')
    const { NextRequest } = await import('next/server')

    // Same-origin mutation → pass
    const sameOrigin = new NextRequest('http://localhost:3000/api/data', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    })
    assert.equal(proxy(sameOrigin).status, 200)

    // Cross-site mutation (sec-fetch-site) → 403
    const crossSite = new NextRequest('http://localhost:3000/api/data', {
      method: 'POST',
      headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(proxy(crossSite).status, 403)

    // Cross-origin mutation (origin mismatch) → 403
    const crossOrigin = new NextRequest('http://localhost:3000/api/data', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://evil.example' },
    })
    assert.equal(proxy(crossOrigin).status, 403)

    // GET is never blocked by the CSRF check
    const get = new NextRequest('http://localhost:3000/api/data', {
      headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(proxy(get).status, 200)
  })
})

test('proxy middleware rejects asymmetric auth config', async () => {
  await withEnv('admin', undefined, async () => {
    const { proxy } = await import('../proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('http://localhost:3000/', { headers: { host: 'localhost:3000' } })
    assert.equal(proxy(req).status, 503)
  })
})
