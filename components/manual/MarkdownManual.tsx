import type { ReactNode } from 'react'

type MarkdownManualProps = {
  source: string
}

export type ManualSection = {
  id: string
  label: string
}

export function manualSlugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[（(]/g, '')
    .replace(/[）)]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

export function extractManualSections(source: string): ManualSection[] {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.match(/^##\s+(.+)$/)?.[1])
    .filter((label): label is string => Boolean(label && label !== '目录'))
    .map(label => ({ id: manualSlugify(label), label }))
}

export function withoutEmbeddedTableOfContents(source: string) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const output: string[] = []
  let skipping = false

  for (const line of lines) {
    if (line.trim() === '## 目录') {
      skipping = true
      continue
    }
    if (skipping && /^---+$/.test(line.trim())) {
      skipping = false
      continue
    }
    if (!skipping) output.push(line)
  }

  return output.join('\n')
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const tokens = value.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)

  return tokens.filter(Boolean).map((token, index) => {
    const key = `${keyPrefix}-${index}`
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={key}>{token.slice(1, -1)}</code>
    }
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={key}>{token.slice(2, -2)}</strong>
    }
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      return <a href={link[2]} key={key}>{link[1]}</a>
    }
    return token
  })
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function isTableDivider(line: string) {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? ''
  const next = lines[index + 1] ?? ''
  return (
    /^#{1,4}\s/.test(line) ||
    /^```/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^---+$/.test(line.trim()) ||
    (line.includes('|') && isTableDivider(next))
  )
}

export function MarkdownManual({ source }: MarkdownManualProps) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const text = heading[2]
      const id = manualSlugify(text)
      const content = renderInline(text, `heading-${index}`)
      if (level === 1) blocks.push(<h1 id={id} key={`block-${index}`}>{content}</h1>)
      if (level === 2) blocks.push(<h2 id={id} key={`block-${index}`}>{content}</h2>)
      if (level === 3) blocks.push(<h3 id={id} key={`block-${index}`}>{content}</h3>)
      if (level === 4) blocks.push(<h4 id={id} key={`block-${index}`}>{content}</h4>)
      index += 1
      continue
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`block-${index}`} />)
      index += 1
      continue
    }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push(
        <pre key={`block-${index}`} data-language={language || undefined}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      const header = tableCells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      blocks.push(
        <div className="manual-table-wrap" key={`block-${index}`}>
          <table>
            <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell, `th-${index}-${cellIndex}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell, `td-${index}-${rowIndex}-${cellIndex}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(<blockquote key={`block-${index}`}>{renderInline(quote.join(' '), `quote-${index}`)}</blockquote>)
      continue
    }

    const unordered = line.match(/^[-*]\s+(.+)$/)
    const ordered = line.match(/^\d+\.\s+(.+)$/)
    if (unordered || ordered) {
      const items: string[] = []
      const pattern = unordered ? /^[-*]\s+(.+)$/ : /^\d+\.\s+(.+)$/
      while (index < lines.length) {
        const item = lines[index].match(pattern)
        if (!item) break
        items.push(item[1])
        index += 1
      }
      const children = items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `li-${index}-${itemIndex}`)}</li>)
      blocks.push(unordered ? <ul key={`block-${index}`}>{children}</ul> : <ol key={`block-${index}`}>{children}</ol>)
      continue
    }

    const paragraph = [line.trim()]
    index += 1
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push(<p key={`block-${index}`}>{renderInline(paragraph.join(' '), `paragraph-${index}`)}</p>)
  }

  return <>{blocks}</>
}
