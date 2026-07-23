/**
 * A small, side-effect-free interpreter for Nuwa generation expressions.
 *
 * It intentionally supports the expression features used by the product while
 * excluding statements, assignment, loops, function definitions, constructors
 * other than Date, and access to JavaScript globals/prototypes.
 */

type TokenKind = 'number' | 'string' | 'identifier' | 'operator' | 'punctuation' | 'eof'

interface Token {
  kind: TokenKind
  value: string
  offset: number
}

type ExpressionNode =
  | { type: 'literal'; value: unknown }
  | { type: 'identifier'; name: string }
  | { type: 'array'; items: ExpressionNode[] }
  | { type: 'unary'; operator: string; argument: ExpressionNode }
  | { type: 'binary'; operator: string; left: ExpressionNode; right: ExpressionNode }
  | { type: 'conditional'; test: ExpressionNode; consequent: ExpressionNode; alternate: ExpressionNode }
  | { type: 'member'; object: ExpressionNode; property: ExpressionNode; optional: boolean }
  | { type: 'call'; callee: ExpressionNode; args: ExpressionNode[] }
  | { type: 'new-date'; args: ExpressionNode[] }

export type SafeExpressionContext = Record<string, unknown>

const MAX_SOURCE_LENGTH = 500
const MAX_TOKENS = 256
const MAX_PARSE_DEPTH = 48
const FORBIDDEN_PROPERTIES = new Set(['__proto__', 'prototype', 'constructor', 'caller', 'callee', 'arguments'])
const ALLOWED_IDENTIFIERS = new Set([
  'index', 'totalRows', 'previousValues', 'refData', 'row', 'parentRow',
  'randomInt', 'randomFloat', 'pick', 'Math', 'Date', 'Number', 'String',
  'Boolean', 'Array', 'parseInt', 'parseFloat', 'isFinite', 'isNaN',
  'formatDate', 'dateFromDistribution',
])

const BINARY_PRECEDENCE: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '===': 4,
  '!==': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
  '**': 8,
}

const MATH_METHODS = new Set([
  'abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh',
  'cbrt', 'ceil', 'clz32', 'cos', 'cosh', 'exp', 'expm1', 'floor',
  'fround', 'hypot', 'imul', 'log', 'log10', 'log1p', 'log2', 'max',
  'min', 'pow', 'random', 'round', 'sign', 'sin', 'sinh', 'sqrt',
  'tan', 'tanh', 'trunc',
])
const MATH_CONSTANTS = new Set(['E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2'])
const DATE_METHODS = new Set([
  'getDate', 'getDay', 'getFullYear', 'getHours', 'getMilliseconds',
  'getMinutes', 'getMonth', 'getSeconds', 'getTime', 'getUTCDate',
  'getUTCDay', 'getUTCFullYear', 'getUTCHours', 'getUTCMilliseconds',
  'getUTCMinutes', 'getUTCMonth', 'getUTCSeconds', 'toISOString',
  'toJSON', 'toString', 'toUTCString', 'valueOf',
])
const STRING_METHODS = new Set([
  'charAt', 'charCodeAt', 'concat', 'endsWith', 'includes', 'indexOf',
  'lastIndexOf', 'padEnd', 'padStart', 'repeat', 'replace', 'slice',
  'split', 'startsWith', 'substring', 'toLowerCase', 'toString',
  'toUpperCase', 'trim', 'trimEnd', 'trimStart', 'valueOf',
])
const ARRAY_METHODS = new Set(['at', 'concat', 'includes', 'indexOf', 'join', 'lastIndexOf', 'slice'])
const NUMBER_METHODS = new Set(['toExponential', 'toFixed', 'toPrecision', 'toString', 'valueOf'])

export class SafeExpressionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SafeExpressionError'
  }
}

function normalizeSource(source: string): string {
  let normalized = source.trim()
  if (normalized.length > MAX_SOURCE_LENGTH) throw new SafeExpressionError('Expression is too long')
  if (/^return\b/.test(normalized)) normalized = normalized.replace(/^return\s+/, '')
  normalized = normalized.replace(/;\s*$/, '').trim()
  if (!normalized) throw new SafeExpressionError('Expression is empty')
  return normalized
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  const push = (kind: TokenKind, value: string, offset: number) => {
    tokens.push({ kind, value, offset })
    if (tokens.length > MAX_TOKENS) throw new SafeExpressionError('Expression is too complex')
  }

  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }

    if (/\d/.test(ch) || (ch === '.' && /\d/.test(source[i + 1] || ''))) {
      const start = i
      if (ch === '.') i++
      while (/\d/.test(source[i] || '')) i++
      if (source[i] === '.') {
        i++
        while (/\d/.test(source[i] || '')) i++
      }
      if (source[i] === 'e' || source[i] === 'E') {
        i++
        if (source[i] === '+' || source[i] === '-') i++
        const exponentStart = i
        while (/\d/.test(source[i] || '')) i++
        if (exponentStart === i) throw new SafeExpressionError(`Invalid number at ${start}`)
      }
      push('number', source.slice(start, i), start)
      continue
    }

    if (ch === '"' || ch === "'") {
      const quote = ch
      const start = i++
      let value = ''
      let closed = false
      while (i < source.length) {
        const current = source[i++]
        if (current === quote) {
          closed = true
          break
        }
        if (current !== '\\') {
          value += current
          continue
        }
        if (i >= source.length) break
        const escaped = source[i++]
        const escapes: Record<string, string> = {
          n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v',
          '0': '\0', '\\': '\\', '"': '"', "'": "'",
        }
        if (escaped === 'u') {
          const hex = source.slice(i, i + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new SafeExpressionError(`Invalid Unicode escape at ${start}`)
          value += String.fromCharCode(parseInt(hex, 16))
          i += 4
        } else {
          value += escapes[escaped] ?? escaped
        }
      }
      if (!closed) throw new SafeExpressionError(`Unterminated string at ${start}`)
      push('string', value, start)
      continue
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const start = i++
      while (/[A-Za-z0-9_$]/.test(source[i] || '')) i++
      push('identifier', source.slice(start, i), start)
      continue
    }

    const operator = ['===', '!==', '?.', '**', '>=', '<=', '==', '!=', '&&', '||', '??']
      .find(candidate => source.startsWith(candidate, i))
    if (operator) {
      push('operator', operator, i)
      i += operator.length
      continue
    }

    if ('+-*/%<>!'.includes(ch)) {
      push('operator', ch, i++)
      continue
    }
    if ('()[],:?.'.includes(ch)) {
      push('punctuation', ch, i++)
      continue
    }

    throw new SafeExpressionError(`Unsupported token at ${i}`)
  }

  tokens.push({ kind: 'eof', value: '', offset: source.length })
  return tokens
}

class Parser {
  private index = 0
  private depth = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): ExpressionNode {
    const expression = this.parseConditional()
    this.expect('eof')
    return expression
  }

  private enter<T>(parse: () => T): T {
    this.depth++
    if (this.depth > MAX_PARSE_DEPTH) throw new SafeExpressionError('Expression nesting is too deep')
    try {
      return parse()
    } finally {
      this.depth--
    }
  }

  private current(): Token {
    return this.tokens[this.index]
  }

  private take(value?: string): Token {
    const token = this.current()
    if (value !== undefined && token.value !== value) {
      throw new SafeExpressionError(`Expected '${value}' at ${token.offset}`)
    }
    this.index++
    return token
  }

  private expect(kind: TokenKind, value?: string): Token {
    const token = this.current()
    if (token.kind !== kind || (value !== undefined && token.value !== value)) {
      throw new SafeExpressionError(`Unexpected token '${token.value}' at ${token.offset}`)
    }
    this.index++
    return token
  }

  private parseConditional(): ExpressionNode {
    return this.enter(() => {
      const test = this.parseBinary(1)
      if (this.current().value !== '?') return test
      this.take('?')
      const consequent = this.parseConditional()
      this.take(':')
      const alternate = this.parseConditional()
      return { type: 'conditional', test, consequent, alternate }
    })
  }

  private parseBinary(minPrecedence: number): ExpressionNode {
    let left = this.parseUnary()
    while (true) {
      const operator = this.current().value
      const precedence = BINARY_PRECEDENCE[operator]
      if (!precedence || precedence < minPrecedence) break
      this.take()
      const nextMinimum = operator === '**' ? precedence : precedence + 1
      const right = this.parseBinary(nextMinimum)
      left = { type: 'binary', operator, left, right }
    }
    return left
  }

  private parseUnary(): ExpressionNode {
    const token = this.current()
    if (token.kind === 'operator' && ['!', '+', '-'].includes(token.value)) {
      this.take()
      return { type: 'unary', operator: token.value, argument: this.parseUnary() }
    }
    return this.parsePostfix(this.parsePrimary())
  }

  private parsePrimary(): ExpressionNode {
    const token = this.current()
    if (token.kind === 'number') {
      this.take()
      return { type: 'literal', value: Number(token.value) }
    }
    if (token.kind === 'string') {
      this.take()
      return { type: 'literal', value: token.value }
    }
    if (token.kind === 'identifier') {
      this.take()
      if (token.value === 'true') return { type: 'literal', value: true }
      if (token.value === 'false') return { type: 'literal', value: false }
      if (token.value === 'null') return { type: 'literal', value: null }
      if (token.value === 'undefined') return { type: 'literal', value: undefined }
      if (token.value === 'new') {
        const constructor = this.expect('identifier')
        if (constructor.value !== 'Date') throw new SafeExpressionError('Only new Date(...) is allowed')
        return { type: 'new-date', args: this.parseArguments() }
      }
      if (!ALLOWED_IDENTIFIERS.has(token.value)) {
        throw new SafeExpressionError(`Identifier '${token.value}' is not allowed`)
      }
      return { type: 'identifier', name: token.value }
    }
    if (token.value === '(') {
      this.take('(')
      const expression = this.parseConditional()
      this.take(')')
      return expression
    }
    if (token.value === '[') {
      this.take('[')
      const items: ExpressionNode[] = []
      if (this.current().value !== ']') {
        do {
          items.push(this.parseConditional())
          if (this.current().value !== ',') break
          this.take(',')
        } while (this.current().value !== ']')
      }
      this.take(']')
      return { type: 'array', items }
    }
    throw new SafeExpressionError(`Expected expression at ${token.offset}`)
  }

  private parsePostfix(initial: ExpressionNode): ExpressionNode {
    let expression = initial
    while (true) {
      const token = this.current()
      if (token.value === '.' || token.value === '?.') {
        const optional = token.value === '?.'
        this.take()
        const property = this.expect('identifier')
        if (FORBIDDEN_PROPERTIES.has(property.value)) {
          throw new SafeExpressionError(`Property '${property.value}' is not allowed`)
        }
        expression = {
          type: 'member',
          object: expression,
          property: { type: 'literal', value: property.value },
          optional,
        }
        continue
      }
      if (token.value === '[') {
        this.take('[')
        const property = this.parseConditional()
        this.take(']')
        if (property.type === 'literal' && FORBIDDEN_PROPERTIES.has(String(property.value))) {
          throw new SafeExpressionError(`Property '${String(property.value)}' is not allowed`)
        }
        expression = { type: 'member', object: expression, property, optional: false }
        continue
      }
      if (token.value === '(') {
        expression = { type: 'call', callee: expression, args: this.parseArguments() }
        continue
      }
      return expression
    }
  }

  private parseArguments(): ExpressionNode[] {
    this.take('(')
    const args: ExpressionNode[] = []
    if (this.current().value !== ')') {
      do {
        args.push(this.parseConditional())
        if (this.current().value !== ',') break
        this.take(',')
      } while (this.current().value !== ')')
    }
    this.take(')')
    return args
  }
}

function propertyKey(value: unknown): string | number {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  const key = String(value)
  if (FORBIDDEN_PROPERTIES.has(key)) throw new SafeExpressionError(`Property '${key}' is not allowed`)
  return key
}

function readMember(receiver: unknown, keyValue: unknown, optional: boolean): unknown {
  if (receiver === null || receiver === undefined) {
    if (optional) return undefined
    throw new SafeExpressionError('Cannot read a property of null or undefined')
  }
  const key = propertyKey(keyValue)

  if (receiver === Math) {
    if (typeof key === 'string' && MATH_CONSTANTS.has(key)) return Math[key as keyof Math]
    throw new SafeExpressionError(`Math.${String(key)} is not allowed as a value`)
  }
  if (Array.isArray(receiver)) {
    if (key === 'length') return receiver.length
    if (typeof key === 'number' || /^\d+$/.test(String(key))) return receiver[Number(key)]
    throw new SafeExpressionError(`Array property '${String(key)}' is not allowed`)
  }
  if (typeof receiver === 'string') {
    if (key === 'length') return receiver.length
    if (typeof key === 'number' || /^\d+$/.test(String(key))) return receiver[Number(key)]
    throw new SafeExpressionError(`String property '${String(key)}' is not allowed`)
  }
  if (receiver instanceof Date) {
    throw new SafeExpressionError(`Date property '${String(key)}' must be called`)
  }
  if (typeof receiver === 'object') {
    if (!Object.prototype.hasOwnProperty.call(receiver, key)) return undefined
    const value = (receiver as Record<string | number, unknown>)[key]
    if (typeof value === 'function') throw new SafeExpressionError('Calling data-provided functions is not allowed')
    return value
  }
  throw new SafeExpressionError(`Cannot read property '${String(key)}'`)
}

function callMember(receiver: unknown, keyValue: unknown, args: unknown[], optional: boolean): unknown {
  if (receiver === null || receiver === undefined) {
    if (optional) return undefined
    throw new SafeExpressionError('Cannot call a method of null or undefined')
  }
  const key = String(propertyKey(keyValue))

  if (receiver === Math && MATH_METHODS.has(key)) {
    const method = Math[key as keyof Math]
    if (typeof method !== 'function') throw new SafeExpressionError(`Math.${key} is not callable`)
    return Reflect.apply(method, Math, args)
  }
  if (receiver === Date && key === 'now') return Date.now()
  if (receiver === Number && key === 'isFinite') return Number.isFinite(args[0])
  if (receiver === Number && key === 'isInteger') return Number.isInteger(args[0])
  if (receiver === Number && key === 'isNaN') return Number.isNaN(args[0])
  if (receiver === Array && key === 'isArray') return Array.isArray(args[0])

  let allowedMethods: Set<string> | null = null
  if (receiver instanceof Date) allowedMethods = DATE_METHODS
  else if (typeof receiver === 'string') allowedMethods = STRING_METHODS
  else if (Array.isArray(receiver)) allowedMethods = ARRAY_METHODS
  else if (typeof receiver === 'number') allowedMethods = NUMBER_METHODS

  if (!allowedMethods?.has(key)) throw new SafeExpressionError(`Method '${key}' is not allowed`)
  const method = Reflect.get(Object(receiver), key)
  if (typeof method !== 'function') throw new SafeExpressionError(`Method '${key}' is not callable`)
  if (key === 'replace' && args.some(arg => typeof arg !== 'string')) {
    throw new SafeExpressionError('String.replace only accepts string arguments')
  }
  return Reflect.apply(method, receiver, args)
}

function resolveIdentifier(name: string, context: SafeExpressionContext): unknown {
  if (FORBIDDEN_PROPERTIES.has(name)) throw new SafeExpressionError(`Identifier '${name}' is not allowed`)
  if (Object.prototype.hasOwnProperty.call(context, name)) return context[name]
  const safeGlobals: Record<string, unknown> = {
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    parseInt: (value: unknown, radix?: unknown) => Number.parseInt(String(value), radix === undefined ? 10 : Number(radix)),
    parseFloat: (value: unknown) => Number.parseFloat(String(value)),
    isFinite: (value: unknown) => Number.isFinite(Number(value)),
    isNaN: (value: unknown) => Number.isNaN(Number(value)),
  }
  if (Object.prototype.hasOwnProperty.call(safeGlobals, name)) return safeGlobals[name]
  throw new SafeExpressionError(`Unknown identifier '${name}'`)
}

function callIdentifier(name: string, fn: unknown, args: unknown[]): unknown {
  const allowed = new Set([
    'randomInt', 'randomFloat', 'pick', 'Number', 'String', 'Boolean',
    'parseInt', 'parseFloat', 'isFinite', 'isNaN', 'formatDate',
    'dateFromDistribution',
  ])
  if (!allowed.has(name) || typeof fn !== 'function') {
    throw new SafeExpressionError(`Function '${name}' is not allowed`)
  }
  return Reflect.apply(fn, undefined, args)
}

function toAdditionPrimitive(value: unknown): unknown {
  // JavaScript uses the string hint for Date objects when applying `+`.
  if (value instanceof Date) return value.toString()
  return value
}

function addValues(left: unknown, right: unknown): unknown {
  const leftPrimitive = toAdditionPrimitive(left)
  const rightPrimitive = toAdditionPrimitive(right)
  if (typeof leftPrimitive === 'string' || typeof rightPrimitive === 'string') {
    return String(leftPrimitive) + String(rightPrimitive)
  }
  return Number(leftPrimitive) + Number(rightPrimitive)
}

function looselyEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || left === undefined) return right === null || right === undefined
  if (right === null || right === undefined) return false

  const leftPrimitive = left instanceof Date ? left.getTime() : left
  const rightPrimitive = right instanceof Date ? right.getTime() : right
  if (typeof leftPrimitive === 'boolean') return looselyEqual(Number(leftPrimitive), rightPrimitive)
  if (typeof rightPrimitive === 'boolean') return looselyEqual(leftPrimitive, Number(rightPrimitive))
  if (
    (typeof leftPrimitive === 'number' && typeof rightPrimitive === 'string') ||
    (typeof leftPrimitive === 'string' && typeof rightPrimitive === 'number')
  ) {
    return Number(leftPrimitive) === Number(rightPrimitive)
  }
  return false
}

function compareValues(left: unknown, right: unknown, operator: '<' | '<=' | '>' | '>='): boolean {
  const leftPrimitive = left instanceof Date ? left.getTime() : left
  const rightPrimitive = right instanceof Date ? right.getTime() : right
  const compareAsStrings = typeof leftPrimitive === 'string' && typeof rightPrimitive === 'string'
  const a = compareAsStrings ? leftPrimitive : Number(leftPrimitive)
  const b = compareAsStrings ? rightPrimitive : Number(rightPrimitive)
  if (operator === '<') return a < b
  if (operator === '<=') return a <= b
  if (operator === '>') return a > b
  return a >= b
}

function evaluate(node: ExpressionNode, context: SafeExpressionContext): unknown {
  switch (node.type) {
    case 'literal': return node.value
    case 'identifier': return resolveIdentifier(node.name, context)
    case 'array': return node.items.map(item => evaluate(item, context))
    case 'unary': {
      const value = evaluate(node.argument, context)
      if (node.operator === '!') return !value
      if (node.operator === '+') return Number(value)
      if (node.operator === '-') return -Number(value)
      throw new SafeExpressionError(`Unsupported unary operator '${node.operator}'`)
    }
    case 'binary': {
      if (node.operator === '&&') {
        const left = evaluate(node.left, context)
        return left ? evaluate(node.right, context) : left
      }
      if (node.operator === '||') {
        const left = evaluate(node.left, context)
        return left ? left : evaluate(node.right, context)
      }
      if (node.operator === '??') {
        const left = evaluate(node.left, context)
        return left === null || left === undefined ? evaluate(node.right, context) : left
      }
      const left = evaluate(node.left, context)
      const right = evaluate(node.right, context)
      switch (node.operator) {
        case '+': return addValues(left, right)
        case '-': return Number(left) - Number(right)
        case '*': return Number(left) * Number(right)
        case '/': return Number(left) / Number(right)
        case '%': return Number(left) % Number(right)
        case '**': return Number(left) ** Number(right)
        case '==': return looselyEqual(left, right)
        case '===': return left === right
        case '!=': return !looselyEqual(left, right)
        case '!==': return left !== right
        case '<': return compareValues(left, right, '<')
        case '<=': return compareValues(left, right, '<=')
        case '>': return compareValues(left, right, '>')
        case '>=': return compareValues(left, right, '>=')
        default: throw new SafeExpressionError(`Unsupported operator '${node.operator}'`)
      }
    }
    case 'conditional': return evaluate(node.test, context) ? evaluate(node.consequent, context) : evaluate(node.alternate, context)
    case 'member': return readMember(evaluate(node.object, context), evaluate(node.property, context), node.optional)
    case 'call': {
      const args = node.args.map(arg => evaluate(arg, context))
      if (node.callee.type === 'identifier') {
        const fn = resolveIdentifier(node.callee.name, context)
        return callIdentifier(node.callee.name, fn, args)
      }
      if (node.callee.type === 'member') {
        const receiver = evaluate(node.callee.object, context)
        const property = evaluate(node.callee.property, context)
        return callMember(receiver, property, args, node.callee.optional)
      }
      throw new SafeExpressionError('Only approved named functions and methods may be called')
    }
    case 'new-date': {
      const args = node.args.map(arg => evaluate(arg, context))
      if (args.length === 0) return new Date()
      if (args.length === 1) return new Date(args[0] as string | number)
      const numbers = args.map(Number)
      return new Date(
        numbers[0], numbers[1], numbers[2] ?? 1, numbers[3] ?? 0,
        numbers[4] ?? 0, numbers[5] ?? 0, numbers[6] ?? 0
      )
    }
  }
}

export function compileSafeExpression(source: string): (context: SafeExpressionContext) => unknown {
  const normalized = normalizeSource(source)
  const ast = new Parser(tokenize(normalized)).parse()
  return context => evaluate(ast, context)
}

export function evaluateSafeExpression(source: string, context: SafeExpressionContext): unknown {
  return compileSafeExpression(source)(context)
}

export function isSafeExpression(source: string): boolean {
  try {
    compileSafeExpression(source)
    return true
  } catch {
    return false
  }
}
