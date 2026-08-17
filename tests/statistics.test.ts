import assert from 'node:assert/strict'
import test from 'node:test'
import { computeColumnStats } from '../services/stats'
import type { ColumnDef } from '../services/types'

function column(type: ColumnDef['type']): ColumnDef {
  return { id: 'score', name: 'score', type }
}

test('number fields use numeric metrics and histogram buckets', () => {
  const stats = computeColumnStats(column('number'), [{ score: 1 }, { score: 2 }, { score: 3 }, { score: 4 }])
  assert.equal(stats.type, 'number')
  assert.equal(stats.count, 4)
  assert.ok(stats.histogram.length > 0)
})

test('legacy text columns containing numeric data use numeric distribution', () => {
  const stats = computeColumnStats(column('text'), [{ score: '0.2' }, { score: '0.8' }, { score: '1' }])
  assert.equal(stats.type, 'number')
})

test('ordinary text fields retain text frequency statistics', () => {
  const stats = computeColumnStats(column('text'), [{ score: '北京' }, { score: '上海' }])
  assert.equal(stats.type, 'text')
})
