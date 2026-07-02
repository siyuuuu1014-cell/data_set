import type { TableDef } from './types'

// ──── SQL ────

function sqlEscape(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
  return `'${String(val).replace(/'/g, "''")}'`
}

export function exportSql(table: TableDef): string {
  if (table.rows.length === 0) return `-- No data in table "${table.name}"\n`
  const cols = table.columns.map(c => c.name)
  const lines = [`-- Table: ${table.name}`, `-- Generated ${table.rows.length} rows`, '']
  for (const row of table.rows) {
    const values = cols.map(c => sqlEscape(row[c])).join(', ')
    lines.push(`INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${values});`)
  }
  return lines.join('\n')
}

export function exportAllSql(tables: TableDef[]): string {
  return tables.map(t => exportSql(t)).join('\n\n')
}

// ──── JSON ────

export function exportJson(table: TableDef): string {
  return JSON.stringify(table.rows, null, 2)
}

export function exportAllJson(tables: TableDef[]): string {
  const result: Record<string, Record<string, unknown>[]> = {}
  for (const t of tables) result[t.name] = t.rows
  return JSON.stringify(result, null, 2)
}

// ──── CSV ────

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function exportCsv(table: TableDef): string {
  const cols = table.columns.map(c => c.name)
  const lines = [cols.map(c => csvEscape(c)).join(',')]
  for (const row of table.rows) {
    lines.push(cols.map(c => csvEscape(row[c])).join(','))
  }
  return '\uFEFF' + lines.join('\n')
}

// ──── XML ────

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function exportXml(table: TableDef): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<table name="${xmlEscape(table.name)}">`]
  for (const row of table.rows) {
    lines.push('  <row>')
    for (const col of table.columns) {
      const val = row[col.name]
      if (val === null || val === undefined) {
        lines.push(`    <${xmlEscape(col.name)} null="true" />`)
      } else {
        lines.push(`    <${xmlEscape(col.name)}>${xmlEscape(String(val))}</${xmlEscape(col.name)}>`)
      }
    }
    lines.push('  </row>')
  }
  lines.push('</table>')
  return lines.join('\n')
}

// ──── Excel XLSX (Office Open XML) ────

function xlsxEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function exportExcel(table: TableDef): Uint8Array {
  const cols = table.columns

  // Build shared strings table
  const strings: string[] = []
  const stringMap = new Map<string, number>()
  const getStrIdx = (s: string): number => {
    const existing = stringMap.get(s)
    if (existing !== undefined) return existing
    const idx = strings.length
    strings.push(s)
    stringMap.set(s, idx)
    return idx
  }

  // Build sheet data XML
  let sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>'

  // Header row
  sheetXml += '<row r="1">'
  for (let ci = 0; ci < cols.length; ci++) {
    const idx = getStrIdx(cols[ci].name)
    sheetXml += `<c r="${colLetter(ci)}1" t="s"><v>${idx}</v></c>`
  }
  sheetXml += '</row>'

  // Data rows
  for (let ri = 0; ri < table.rows.length; ri++) {
    const rowNum = ri + 2
    sheetXml += `<row r="${rowNum}">`
    for (let ci = 0; ci < cols.length; ci++) {
      const val = table.rows[ri][cols[ci].name]
      const cellRef = `${colLetter(ci)}${rowNum}`
      if (val === null || val === undefined) continue
      if (typeof val === 'number') {
        sheetXml += `<c r="${cellRef}"><v>${val}</v></c>`
      } else if (typeof val === 'boolean') {
        sheetXml += `<c r="${cellRef}" t="b"><v>${val ? '1' : '0'}</v></c>`
      } else {
        const idx = getStrIdx(String(val))
        sheetXml += `<c r="${cellRef}" t="s"><v>${idx}</v></c>`
      }
    }
    sheetXml += '</row>'
  }
  sheetXml += '</sheetData></worksheet>'

  // Shared strings XML
  let sstXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + strings.length + '" uniqueCount="' + strings.length + '">'
  for (const s of strings) {
    sstXml += `<si><t xml:space="preserve">${xlsxEscape(s)}</t></si>`
  }
  sstXml += '</sst>'

  // Styles XML
  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'

  // Workbook XML
  const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'

  // Workbook rels
  const wbRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'

  // Content Types
  const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'

  // Root rels
  const rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'

  const fileEntries: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: encodeUTF8(contentTypesXml) },
    { name: '_rels/.rels', data: encodeUTF8(rootRelsXml) },
    { name: 'xl/workbook.xml', data: encodeUTF8(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: encodeUTF8(wbRelsXml) },
    { name: 'xl/worksheets/sheet1.xml', data: encodeUTF8(sheetXml) },
    { name: 'xl/sharedStrings.xml', data: encodeUTF8(sstXml) },
    { name: 'xl/styles.xml', data: encodeUTF8(stylesXml) },
  ]

  return buildZip(fileEntries)
}

function encodeUTF8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function colLetter(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    n--
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}

// ──── ZIP builder (store method, table-based CRC32) ────

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  return table
}

const CRC_TABLE = makeCrc32Table()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const cdParts: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const size = file.data.length
    const crc = crc32(file.data)

    // Local file header: 30 bytes + filename
    const lh = new Uint8Array(30 + nameBytes.length)
    lh[0] = 0x50; lh[1] = 0x4b; lh[2] = 0x03; lh[3] = 0x04 // signature
    lh[4] = 20; lh[5] = 0 // version needed: 2.0
    lh[6] = 0; lh[7] = 0 // flags
    lh[8] = 0; lh[9] = 0 // store
    lh[10] = 0; lh[11] = 0 // mod time
    lh[12] = 0; lh[13] = 0 // mod date
    // crc at 14-17 (LE)
    lh[14] = crc & 0xff
    lh[15] = (crc >>> 8) & 0xff
    lh[16] = (crc >>> 16) & 0xff
    lh[17] = (crc >>> 24) & 0xff
    // compressed size at 18-21
    lh[18] = size & 0xff
    lh[19] = (size >>> 8) & 0xff
    lh[20] = (size >>> 16) & 0xff
    lh[21] = (size >>> 24) & 0xff
    // uncompressed size at 22-25 (same as compressed for store)
    lh[22] = size & 0xff
    lh[23] = (size >>> 8) & 0xff
    lh[24] = (size >>> 16) & 0xff
    lh[25] = (size >>> 24) & 0xff
    // filename length at 26-27
    lh[26] = nameBytes.length & 0xff
    lh[27] = (nameBytes.length >>> 8) & 0xff
    lh[28] = 0; lh[29] = 0 // extra length
    lh.set(nameBytes, 30)

    parts.push(lh)
    parts.push(file.data)

    // Central directory entry: 46 bytes + filename
    const ce = new Uint8Array(46 + nameBytes.length)
    ce[0] = 0x50; ce[1] = 0x4b; ce[2] = 0x01; ce[3] = 0x02 // signature
    ce[4] = 20; ce[5] = 0 // version made by
    ce[6] = 20; ce[7] = 0 // version needed
    ce[8] = 0; ce[9] = 0 // flags
    ce[10] = 0; ce[11] = 0 // store
    ce[12] = 0; ce[13] = 0 // mod time
    ce[14] = 0; ce[15] = 0 // mod date
    // crc at 16-19
    ce[16] = crc & 0xff
    ce[17] = (crc >>> 8) & 0xff
    ce[18] = (crc >>> 16) & 0xff
    ce[19] = (crc >>> 24) & 0xff
    // compressed size at 20-23
    ce[20] = size & 0xff
    ce[21] = (size >>> 8) & 0xff
    ce[22] = (size >>> 16) & 0xff
    ce[23] = (size >>> 24) & 0xff
    // uncompressed size at 24-27
    ce[24] = size & 0xff
    ce[25] = (size >>> 8) & 0xff
    ce[26] = (size >>> 16) & 0xff
    ce[27] = (size >>> 24) & 0xff
    // filename length at 28-29
    ce[28] = nameBytes.length & 0xff
    ce[29] = (nameBytes.length >>> 8) & 0xff
    ce[30] = 0; ce[31] = 0 // extra
    ce[32] = 0; ce[33] = 0 // comment
    ce[34] = 0; ce[35] = 0 // disk
    ce[36] = 0; ce[37] = 0 // internal attrs
    ce[38] = 0; ce[39] = 0; ce[40] = 0; ce[41] = 0 // external attrs
    // local header offset at 42-45
    ce[42] = offset & 0xff
    ce[43] = (offset >>> 8) & 0xff
    ce[44] = (offset >>> 16) & 0xff
    ce[45] = (offset >>> 24) & 0xff
    ce.set(nameBytes, 46)

    cdParts.push(ce)
    offset += lh.length + size
  }

  // Concatenate local headers + data
  let totalLocalSize = 0
  for (const p of parts) totalLocalSize += p.length
  const result = new Uint8Array(totalLocalSize + cdParts.reduce((s, e) => s + e.length, 0) + 22)
  let pos = 0
  for (const p of parts) {
    result.set(p, pos)
    pos += p.length
  }

  const cdStart = pos
  for (const ce of cdParts) {
    result.set(ce, pos)
    pos += ce.length
  }
  const cdSize = pos - cdStart
  const cdCount = files.length

  // EOCD: 22 bytes
  result[pos] = 0x50; result[pos + 1] = 0x4b; result[pos + 2] = 0x05; result[pos + 3] = 0x06
  result[pos + 4] = 0; result[pos + 5] = 0 // disk
  result[pos + 6] = 0; result[pos + 7] = 0 // disk with CD
  result[pos + 8] = cdCount & 0xff; result[pos + 9] = (cdCount >>> 8) & 0xff
  result[pos + 10] = cdCount & 0xff; result[pos + 11] = (cdCount >>> 8) & 0xff
  result[pos + 12] = cdSize & 0xff
  result[pos + 13] = (cdSize >>> 8) & 0xff
  result[pos + 14] = (cdSize >>> 16) & 0xff
  result[pos + 15] = (cdSize >>> 24) & 0xff
  result[pos + 16] = cdStart & 0xff
  result[pos + 17] = (cdStart >>> 8) & 0xff
  result[pos + 18] = (cdStart >>> 16) & 0xff
  result[pos + 19] = (cdStart >>> 24) & 0xff
  result[pos + 20] = 0; result[pos + 21] = 0 // comment length

  return result
}

// ──── Download helper ────

export function downloadFile(content: string | Uint8Array, filename: string, mimeType: string) {
  const blob = new Blob([content as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
