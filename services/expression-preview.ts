import { compileSafeExpression } from './safe-expression'
import { formatDate } from './code-gen'

export function previewGenerationExpression(code: string, kind: 'value' | 'boolean' = 'value'): unknown[] {
  const evaluateExpression = compileSafeExpression(code)
  const testRefData = {
    users: [{ id: 1, name: 'test' }],
    orders: [{ id: 1 }],
    products: [{ id: 1 }],
  }
  const fallbackValue = () => kind === 'boolean' ? (Math.random() > 0.5 ? 1 : 0) : new Date()
  const testRow = new Proxy<Record<string, unknown>>({}, {
    get: fallbackValue,
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: fallbackValue() }),
  })
  const testParentRow = kind === 'boolean'
    ? { id: 1, name: 'test', is_premium: 1 }
    : { id: 1, name: 'test', price: 100 }
  const testPick = (arr: unknown[]) => Array.isArray(arr) && arr.length > 0
    ? arr[Math.floor(Math.random() * arr.length)]
    : undefined
  const testRandomInt = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a
  const testRandomFloat = (a: number, b: number) => Math.random() * (b - a) + a

  const results: unknown[] = []
  for (let i = 0; i < 5; i++) {
    results.push(evaluateExpression({
      index: i,
      totalRows: 5,
      previousValues: results,
      refData: testRefData,
      row: testRow,
      randomInt: testRandomInt,
      randomFloat: testRandomFloat,
      pick: testPick,
      parentRow: testParentRow,
      formatDate,
      dateFromDistribution: () => formatDate(new Date(), 'date'),
    }))
  }
  return results
}
