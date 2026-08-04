import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { generatePhone } from '../services/code-gen'
import { generateColumn } from '../services/data-gen'
import { writeParquet, readParquet, renameParquet, parquetExists } from '../services/parquet'
import type { ColumnDef } from '../services/types'

// Redirect Parquet writes to a temp directory so tests never touch the
// repository's real generated_data/ (crash-residue and cwd coupling).
let parquetRoot: string
before(async () => {
  parquetRoot = await mkdtemp(path.join(tmpdir(), 'nuwa-parquet-test-'))
  process.env.NUWA_DATA_DIR = parquetRoot
})
after(async () => {
  delete process.env.NUWA_DATA_DIR
  await rm(parquetRoot, { recursive: true, force: true })
})

const PHONE_LENGTHS: Record<string, number> = {
  CN: 11, US: 10, JP: 11, KR: 11, GB: 11, DE: 12, FR: 10, IN: 10, BR: 11, AU: 10,
}

test('phone numbers include the full national digit count per country', () => {
  for (const [country, expected] of Object.entries(PHONE_LENGTHS)) {
    for (let i = 0; i < 20; i++) {
      const number = generatePhone(country).split(' ')[1]
      assert.equal(number.length, expected, `${country} phone should have ${expected} digits`)
    }
  }
})

test('boolean columns with code keep nulls instead of coercing to 0', async () => {
  const col: ColumnDef = {
    id: 'flag',
    name: 'flag',
    type: 'boolean',
    nullable: true,
    nullRatio: 100,
    generationCode: 'row.amount > 0 ? 1 : 0',
  }
  const values = await generateColumn(col, 5, {})
  assert.ok(values.every(value => value === null), 'all values should stay null after null ratio')
})

function boolColumn(): ColumnDef {
  return { id: 'flag', name: 'flag', type: 'boolean' }
}

test('writeParquet keeps null booleans as null instead of writing 0', async () => {
  const projectId = `test-bool-${Date.now()}`
  const tableName = 'flags'
  try {
    await writeParquet(projectId, tableName, [boolColumn()], [
      { flag: true },
      { flag: false },
      { flag: null },
    ])
    const rows = await readParquet(projectId, tableName)
    assert.equal(rows.length, 3)
    assert.equal(rows[0].flag, 1)
    assert.equal(rows[1].flag, 0)
    assert.equal(rows[2].flag, null, 'null boolean must stay null')
  } finally {
    const { deleteParquetTable } = await import('../services/parquet')
    deleteParquetTable(projectId, tableName)
  }
})

test('renameParquet moves the file and rejects collisions', async () => {
  const projectId = `test-rename-${Date.now()}`
  const tableName = 'a_table'
  try {
    await writeParquet(projectId, tableName, [boolColumn()], [{ flag: 1 }])
    assert.ok(parquetExists(projectId, tableName))

    const renamed = renameParquet(projectId, tableName, 'b_table')
    assert.equal(renamed, true)
    assert.equal(parquetExists(projectId, tableName), false)
    assert.ok(parquetExists(projectId, 'b_table'))

    const rows = await readParquet(projectId, 'b_table')
    assert.equal(rows.length, 1)

    await writeParquet(projectId, 'c_table', [boolColumn()], [{ flag: 0 }])
    assert.throws(() => renameParquet(projectId, 'b_table', 'c_table'), /已存在/)
  } finally {
    const { deleteParquetProject } = await import('../services/parquet')
    deleteParquetProject(projectId)
  }
})

// ── Histogram last bucket must include the maximum value ──

import { computeColumnStats } from '../services/stats'

test('histogram includes the maximum value in its last bucket', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ n: i + 1 })) // 1..10
  const stats = computeColumnStats({ id: 'n', name: 'n', type: 'number' }, rows)
  assert.equal(stats.type, 'number')
  if (stats.type !== 'number') return
  const total = stats.histogram.reduce((sum, bin) => sum + bin.count, 0)
  assert.equal(total, 10, `histogram total ${total} must equal value count`)
  const last = stats.histogram[stats.histogram.length - 1]
  assert.ok(last.count >= 1, 'last bucket must contain the max value')
})

// ── Server-state merge must preserve local pending edits ──

import { mergeSegmentAnnotationFromServer } from '../services/video-annotation/frame-annotations'
import type { SegmentAnnotation } from '../services/video-annotation/types'

function baseAnnotation(): SegmentAnnotation {
  return {
    segmentId: 1,
    start: 10,
    end: 12,
    scene: { tags: [], place: { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' } },
    camera: { shot: 'unknown', angle: 'unknown', movement: [], lens: 'unknown', stabilization: 'unknown' },
    persons: [],
    objects: [],
    events: [],
    frames: [],
  }
}

test('merge keeps local pending resize while adopting the server track', () => {
  const local = baseAnnotation()
  // Local pending edit: track 5 resized
  local.objects = [{ trackId: 5, name: 'cup', category: 'other', color: 'unknown', brand: null, bbox: { x: 70, y: 70, width: 10, height: 10 }, depth: null }]
  local.frames = [{ frameIndex: 0, timestamp: 11, imageWidth: 100, imageHeight: 100, observations: [{ trackId: 5, entityType: 'object', className: 'cup', bbox: { x: 70, y: 70, width: 10, height: 10 }, source: 'manual' }] }]

  // Server snapshot: old bbox for track 5 + a new track 6 (the draw response)
  const server = baseAnnotation()
  server.objects = [
    { trackId: 5, name: 'cup', category: 'other', color: 'unknown', brand: null, bbox: { x: 60, y: 60, width: 20, height: 20 }, depth: null },
    { trackId: 6, name: 'box', category: 'other', color: 'unknown', brand: null, bbox: { x: 10, y: 10, width: 30, height: 30 }, depth: null },
  ]
  server.frames = [{ frameIndex: 0, timestamp: 11, imageWidth: 100, imageHeight: 100, observations: [
    { trackId: 5, entityType: 'object', className: 'cup', bbox: { x: 60, y: 60, width: 20, height: 20 }, source: 'manual' },
    { trackId: 6, entityType: 'object', className: 'box', bbox: { x: 10, y: 10, width: 30, height: 30 }, source: 'manual' },
  ] }]

  const merged = mergeSegmentAnnotationFromServer(local, server)
  const track5 = merged.objects.find(o => o.trackId === 5)
  assert.ok(track5, 'track 5 must survive the merge')
  assert.deepEqual(track5!.bbox, { x: 70, y: 70, width: 10, height: 10 }, 'local resize of track 5 must win')
  const track6 = merged.objects.find(o => o.trackId === 6)
  assert.ok(track6, 'server track 6 must be adopted')
  const frame0 = merged.frames?.[0]
  assert.equal(frame0?.observations.length, 2, 'both observations must be present in the merged frame')
})

// ── CSV formula injection guard ──

import { exportCsv, exportSql } from '../services/export'
import type { TableDef } from '../services/types'

function textColumn(): ColumnDef {
  return { id: 'c1', name: 'value', type: 'text', llmPrompt: '', generationCode: '' }
}

test('csv export neutralizes spreadsheet formula injection', () => {
  const table: TableDef = {
    id: 't1',
    name: 't1',
    columns: [textColumn()],
    rows: [{ value: '=SUM(A1:A9)' }, { value: '+1+1' }, { value: '@cmd' }, { value: 'normal' }],
  }
  const csv = exportCsv(table)
  assert.ok(csv.includes("'=SUM(A1:A9)"), 'leading = must be prefixed')
  assert.ok(csv.includes("'+1+1"), 'leading + must be prefixed')
  assert.ok(csv.includes("'@cmd"), 'leading @ must be prefixed')
  assert.ok(!csv.includes("'normal"), 'normal values must not be prefixed')
})

test('sql export quotes identifiers', () => {
  const table: TableDef = {
    id: 't1',
    name: 'my table',
    columns: [{ ...textColumn(), name: 'select' }],
    rows: [{ select: 'x' }],
  }
  const sql = exportSql(table)
  assert.ok(sql.includes('"my table"'), 'table name must be quoted')
  assert.ok(sql.includes('"select"'), 'reserved-word column must be quoted')
})
