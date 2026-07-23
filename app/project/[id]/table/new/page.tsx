'use client'

import React from 'react'
import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import type { ColumnDef, ColumnType, IdFormat, PhoneCountry, DateFormat, DateRange } from '@/services/types'
import Link from 'next/link'
import { previewGenerationExpression } from '@/services/expression-preview'

let _colIdCounter = Date.now()
function genColId(): string {
  return 'col_' + (_colIdCounter++).toString(36)
}

const COLUMN_TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: '文本 (LLM生成)' },
  { value: 'number', label: '数字 (代码生成)' },
  { value: 'boolean', label: '布尔值' },
  { value: 'date', label: '日期' },
  { value: 'id', label: 'ID (自增/雪花)' },
  { value: 'phone', label: '电话' },
  { value: 'city', label: '城市' },
  { value: 'foreign_key', label: '外键 (引用其他表)' },
  { value: 'foreign_key_array', label: '外键数组' },
]

const ID_FORMATS: { value: IdFormat; label: string }[] = [
  { value: 'uuid4', label: 'UUID v4' },
  { value: 'uuid7', label: 'UUID v7' },
  { value: 'snowflake', label: '雪花ID (Snowflake)' },
  { value: 'auto_increment', label: '自增 (1,2,3...)' },
  { value: 'cuid2', label: 'CUID2' },
  { value: 'objectid', label: 'MongoDB ObjectID' },
  { value: 'nanoid', label: 'Nano ID' },
  { value: 'ulid', label: 'ULID' },
]

const TYPE_SHORT_LABEL: Record<ColumnType, string> = {
  text: '文本', number: '数字', boolean: '布尔', date: '日期',
  foreign_key: '外键', foreign_key_array: '外键数组', id: 'ID', phone: '电话', city: '城市',
}

const PHONE_COUNTRIES: { value: PhoneCountry; label: string }[] = [
  { value: 'CN', label: '中国 (+86)' },
  { value: 'US', label: '美国 (+1)' },
  { value: 'JP', label: '日本 (+81)' },
  { value: 'KR', label: '韩国 (+82)' },
  { value: 'GB', label: '英国 (+44)' },
  { value: 'DE', label: '德国 (+49)' },
  { value: 'FR', label: '法国 (+33)' },
  { value: 'IN', label: '印度 (+91)' },
  { value: 'BR', label: '巴西 (+55)' },
  { value: 'AU', label: '澳大利亚 (+61)' },
]

const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: 'date', label: 'yyyy-MM-dd' },
  { value: 'datetime', label: 'yyyy-MM-dd HH:mm:ss' },
  { value: 'iso', label: 'ISO 8601' },
  { value: 'date_slash', label: 'yyyy/MM/dd' },
  { value: 'date_us', label: 'MM/dd/yyyy' },
  { value: 'date_eu', label: 'dd-MM-yyyy' },
  { value: 'time', label: 'HH:mm:ss' },
  { value: 'unix_s', label: 'Unix 时间戳 (秒)' },
  { value: 'unix_ms', label: 'Unix 时间戳 (毫秒)' },
]

const PRESET_DATE_RANGES: Omit<DateRange, 'ratio'>[] = [
  { label: '近7日', minDays: 0, maxDays: 7 },
  { label: '近15日', minDays: 0, maxDays: 15 },
  { label: '近30日', minDays: 0, maxDays: 30 },
  { label: '近3个月', minDays: 0, maxDays: 90 },
  { label: '近6个月', minDays: 0, maxDays: 180 },
  { label: '近1年', minDays: 0, maxDays: 365 },
  { label: '近3年', minDays: 0, maxDays: 1095 },
]

function ensureDateDistribution(col: ColumnDef): DateRange[] {
  if (!col.dateDistribution || col.dateDistribution.length === 0) {
    return PRESET_DATE_RANGES.map(r => ({ ...r, ratio: 0 }))
  }
  return col.dateDistribution
}

function emptyColumn(): ColumnDef {
  return { id: genColId(), name: '', type: 'text', llmPrompt: '', generationCode: '' }
}

const VISION_SYSTEM_PROMPT = `You are a data table column analyzer. Analyze the screenshot to identify all table columns.

For each column, determine:
- name: column name in snake_case English (e.g. "user_id", "order_date", "product_name")
- type: one of "text", "number", "date", "boolean", "id"
- llmPrompt: a Chinese description of how to generate realistic synthetic data for this column (e.g. "随机生成中文姓名", "最近3年的随机日期")

Respond with ONLY a JSON array, no markdown, no explanation:
[{"name":"column_name","type":"text","llmPrompt":"生成规则描述"}]`

function extractJsonArray(raw: string): Record<string, unknown>[] | null {
  try { return JSON.parse(raw) as Record<string, unknown>[] } catch { /* not pure JSON */ }
  const match = raw.match(/\[[\s\S]*?\]/)
  if (match) {
    try { return JSON.parse(match[0]) as Record<string, unknown>[] } catch { /* fail */ }
  }
  return null
}

/** Resize image to max 1920px on longest side, return as JPEG base64 data URL. */
function resizeImage(file: File, maxPx = 1920, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width <= maxPx && height <= maxPx) {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('图片读取失败'))
        reader.readAsDataURL(file)
        return
      }
      const ratio = Math.min(maxPx / width, maxPx / height)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = URL.createObjectURL(file)
  })
}

export default function NewTablePage() {
  const { id } = useParams<{ id: string }>()
  const { projects, getTables, addTable } = useStore()
  const { t } = useLang()
  const router = useRouter()

  const project = projects.find(p => p.id === id)
  const existingTables = getTables(id)

  const [tableName, setName] = useState('')
  const [columns, setColumns] = useState<ColumnDef[]>([emptyColumn()])
  const [error, setError] = useState('')
  const [llmConfigured, setLlmConfigured] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [imageUploading, setImageUploading] = useState(false)
  const [importingNuwa, setImportingNuwa] = useState(false)
  const [importedRows, setImportedRows] = useState<Record<string, unknown>[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nuwaFileRef = useRef<HTMLInputElement>(null)
  const [relatedTableIds, setRelatedTableIds] = useState<string[]>([])
  const [importedColMap, setImportedColMap] = useState<Record<string, Record<string, string>>>({})
  const [fkModeCols, setFkModeCols] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/llm/config').then(r => r.json()).then(d => setLlmConfigured(d.configured)).catch(() => {})
  }, [])

  const hasTextCols = columns.some(c => c.type === 'text')

  if (!project) return null

  const updateCol = (colId: string, updates: Partial<ColumnDef>) => {
    setColumns(prev => prev.map(c => (c.id === colId ? { ...c, ...updates } : c)))
  }

  const addColumn = (afterIndex?: number) => {
    setColumns(prev => {
      if (afterIndex !== undefined && afterIndex >= 0 && afterIndex < prev.length) {
        return [...prev.slice(0, afterIndex + 1), emptyColumn(), ...prev.slice(afterIndex + 1)]
      }
      return [...prev, emptyColumn()]
    })
  }

  const removeColumn = (colId: string) => {
    if (columns.length <= 1) return
    setColumns(prev => prev.filter(c => c.id !== colId))
  }

  const toggleRelatedTable = (tableId: string) => {
    if (relatedTableIds.includes(tableId)) {
      setRelatedTableIds(prev => prev.filter(id => id !== tableId))
      const removedColIds = Object.values(importedColMap[tableId] || {})
      const removedSet = new Set(removedColIds)
      setColumns(prev => prev.filter(c => !removedSet.has(c.id)))
      setFkModeCols(prev => {
        const next = new Set(prev)
        for (const key of prev) {
          if (key.startsWith(`${tableId}:`)) next.delete(key)
        }
        return next
      })
      setImportedColMap(prev => {
        const next = { ...prev }
        delete next[tableId]
        return next
      })
    } else {
      setRelatedTableIds(prev => [...prev, tableId])
    }
  }

  const toggleImportCol = (tableId: string, tableName: string, col: ColumnDef) => {
    const existing = importedColMap[tableId]?.[col.name]
    if (existing) {
      setColumns(prev => prev.filter(c => c.id !== existing))
      setImportedColMap(prev => {
        if (!prev[tableId]) return prev
        const next = { ...prev, [tableId]: { ...prev[tableId] } }
        delete next[tableId][col.name]
        return next
      })
      setFkModeCols(prev => {
        const next = new Set(prev)
        next.delete(`${tableId}:${col.name}`)
        return next
      })
    } else {
      const newColId = genColId()
      const newCol: ColumnDef = {
        id: newColId,
        name: `${tableName}_${col.name}`,
        type: col.type,
        foreignTable: tableId,
        foreignColumn: col.name,
      }
      setColumns(prev => [...prev, newCol])
      setImportedColMap(prev => ({
        ...prev,
        [tableId]: { ...(prev[tableId] || {}), [col.name]: newColId },
      }))
    }
  }

  const toggleFkMode = (tableId: string, colName: string) => {
    const colId = importedColMap[tableId]?.[colName]
    if (!colId) return
    const key = `${tableId}:${colName}`
    setFkModeCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        const table = existingTables.find(t => t.id === tableId)
        const srcCol = table?.columns.find(c => c.name === colName)
        updateCol(colId, { type: srcCol?.type || 'text' })
      } else {
        next.add(key)
        updateCol(colId, { type: 'foreign_key' })
      }
      return next
    })
  }

  const randomSelectColumns = (table: { id: string; name: string; columns: ColumnDef[] }) => {
    const count = Math.min(table.columns.length, Math.max(1, Math.floor(Math.random() * table.columns.length) + 1))
    const shuffled = [...table.columns].sort(() => Math.random() - 0.5)
    const selected = shuffled.slice(0, count)

    const newCols: ColumnDef[] = []
    const newMapEntries: [string, string][] = []

    for (const col of selected) {
      if (importedColMap[table.id]?.[col.name]) continue
      const newColId = genColId()
      newCols.push({
        id: newColId,
        name: `${table.name}_${col.name}`,
        type: col.type,
        foreignTable: table.id,
        foreignColumn: col.name,
      })
      newMapEntries.push([col.name, newColId])
    }

    if (newCols.length === 0) return

    setColumns(prev => [...prev, ...newCols])
    setImportedColMap(prev => {
      const existing = prev[table.id] || {}
      const merged = { ...existing }
      for (const [k, v] of newMapEntries) merged[k] = v
      return { ...prev, [table.id]: merged }
    })
  }

  const handleImportNuwa = async (file: File) => {
    setError('')
    setImportingNuwa(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const tables = data.tables || (data.table ? [data.table] : null)
      if (!tables || !Array.isArray(tables)) throw new Error('无效的 .nuwa 文件格式')
      const newCols: ColumnDef[] = []
      let firstName = ''
      let fileRows: Record<string, unknown>[] = []
      for (const nuwaTable of tables) {
        if (!firstName && nuwaTable.name) firstName = nuwaTable.name
        if (nuwaTable.columns && Array.isArray(nuwaTable.columns)) {
          for (const col of nuwaTable.columns) {
            newCols.push({
              id: genColId(),
              name: col.name || '',
              type: col.type || 'text',
              llmPrompt: col.llmPrompt || '',
              generationCode: col.generationCode || '',
              nullable: col.nullable,
              nullRatio: col.nullRatio,
              foreignTable: col.foreignTable,
              foreignColumn: col.foreignColumn,
              localMatchColumn: col.localMatchColumn,
              parentDateColumn: col.parentDateColumn,
              dateFormat: col.dateFormat,
              dateDistribution: col.dateDistribution,
              idFormat: col.idFormat,
              phoneCountry: col.phoneCountry,
              cityCountry: col.cityCountry,
            })
          }
        }
        if (nuwaTable.rows && Array.isArray(nuwaTable.rows) && nuwaTable.rows.length > 0) {
          fileRows = nuwaTable.rows
        }
      }
      if (newCols.length > 0) {
        if (firstName && !tableName.trim()) setName(firstName)
        setColumns(newCols)
        setImportedRows(fileRows)
        const rowMsg = fileRows.length > 0 ? `，含 ${fileRows.length} 行数据` : ''
        setError(`已导入 ${newCols.length} 个列定义${rowMsg}`)
      } else {
        setError('文件中没有找到列定义')
      }
      if (nuwaFileRef.current) nuwaFileRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImportingNuwa(false)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setError('图片大小不能超过 10MB')
      return
    }
    setImageUploading(true)
    setError('')
    try {
      const base64 = await resizeImage(file)
      const { callLlmVision } = await import('@/services/llm')
      const raw = await callLlmVision(VISION_SYSTEM_PROMPT, '请识别图片中的表格列结构', [base64])
      const parsed = extractJsonArray(raw)
      if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
        setError('未能从图片中识别出有效的列结构。请确保图片包含表格信息。')
        return
      }
      const newCols: ColumnDef[] = parsed.map((item: Record<string, unknown>) => ({
        id: genColId(),
        name: (item.name as string) || 'unnamed',
        type: (item.type as ColumnType) || 'text',
        llmPrompt: (item.llmPrompt as string) || '',
        generationCode: '',
      }))
      setColumns(newCols)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片识别失败')
    } finally {
      setImageUploading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!tableName.trim()) {
      setError(t('table.name_required'))
      return
    }
    const invalidCol = columns.find(c => !c.name.trim())
    if (invalidCol) {
      setError(t('table.col_name_required'))
      return
    }
    const emptyTextCols = columns.filter(c => c.type === 'text' && !c.nullable && !c.llmPrompt?.trim())
    if (emptyTextCols.length > 0) {
      setError(`${t('table.text_prompt_required')}: "${emptyTextCols[0].name}"`)
      return
    }
    const fkCols = columns.filter(c => c.type === 'foreign_key')
    for (const col of fkCols) {
      if (!col.foreignTable) {
        setError(`${t('table.fk_table_required')}: "${col.name}"`)
        return
      }
    }

    const tableId = 'tbl_' + Date.now().toString(36)
    const rows = importedRows.length > 0 ? importedRows : []
    addTable(id, {
      id: tableId,
      name: tableName.trim(),
      columns,
      rows,
    })
    // If imported rows exist, save them to Parquet
    if (rows.length > 0) {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, tableName: tableName.trim(), columns, rows }),
      }).catch(() => {})
    }
    router.push(`/project/${id}/table/${tableId}`)
  }

  return (
    <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/project/${id}`} className="text-gv-text-dim hover:text-gv-pink transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-lg font-semibold text-gv-text">{t('table.new_title')}</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* LLM status */}
        {hasTextCols && (
          <div className={`rounded-lg border p-3 text-sm ${
            llmConfigured
              ? 'bg-gv-green/10 border-gv-green/30 text-gv-green-dark'
              : 'bg-gv-pink/10 border-gv-pink/30 text-gv-pink-dark'
          }`}>
            {llmConfigured
              ? 'LLM 已配置，文本列将调用模型生成。'
              : <>{t('app.unconfigured')}。<Link href="/settings" className="underline font-medium ml-1">{t('home.settings_hint')}</Link></>
            }
          </div>
        )}

        {/* Table name */}
        <div>
          <label className="block text-sm font-medium text-gv-text mb-2">{t('table.name')}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={tableName}
              onChange={(e) => { setName(e.target.value); setError('') }}
              placeholder={t('table.name_placeholder')}
              className="input-field flex-1 py-3 text-base"
              autoFocus
            />
            <input ref={nuwaFileRef} type="file" accept=".nuwa" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportNuwa(f) }} />
            <button type="button"
              onClick={() => nuwaFileRef.current?.click()}
              disabled={importingNuwa}
              className="btn-outline rounded-lg px-3 py-1.5 text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
              {importingNuwa ? '...' : '导入 .nuwa'}
            </button>
          </div>
        </div>

        {/* Related Tables */}
        {existingTables.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gv-text mb-2">{t('table.related_tables')}</label>
            <p className="text-xs text-gv-text-muted mb-3">{t('table.related_hint')}</p>
            <div className="space-y-2">
              {existingTables.map(table => {
                const isRelated = relatedTableIds.includes(table.id)
                const importedColsForTable = importedColMap[table.id] || {}
                return (
                  <div key={table.id} className="card overflow-hidden">
                    <label className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-gv-bg/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={isRelated}
                        onChange={() => toggleRelatedTable(table.id)}
                        className="rounded accent-gv-pink"
                      />
                      <span className="text-sm font-medium text-gv-text">{table.name}</span>
                      <span className="text-xs text-gv-text-muted">({table.columns.length} {t('project.columns_count')})</span>
                      {isRelated && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); randomSelectColumns(table) }}
                          className="ml-auto text-xs text-gv-pink hover:text-gv-pink-dark font-medium transition-colors"
                        >
                          {t('table.random_select')}
                        </button>
                      )}
                    </label>
                    {isRelated && (
                      <div className="border-t border-gv-border px-4 py-3 bg-gv-bg/50">
                        <div className="flex flex-wrap gap-2">
                          {table.columns.map(col => {
                            const isImported = !!importedColsForTable[col.name]
                            const isFk = fkModeCols.has(`${table.id}:${col.name}`)
                            return (
                            <label
                              key={col.id}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer border transition-all duration-200 ${
                                isImported
                                  ? 'bg-gv-pink/10 border-gv-pink/30 text-gv-pink font-medium'
                                  : 'bg-white border-gv-border text-gv-text-dim hover:border-gv-pink/30'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isImported}
                                onChange={() => toggleImportCol(table.id, table.name, col)}
                                className="sr-only"
                              />
                              {col.name}
                              <span className="text-gv-text-muted">({TYPE_SHORT_LABEL[col.type]})</span>
                              {isImported && (
                                <span
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFkMode(table.id, col.name) }}
                                  className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors ${
                                    isFk
                                      ? 'bg-gv-pink/20 text-gv-pink-dark'
                                      : 'bg-gv-green/20 text-gv-green-dark'
                                  }`}
                                  title={isFk ? '外键模式 (点击切换)' : '直接值模式 (点击切换)'}
                                >
                                  {isFk ? 'FK' : t('table.col_name')}
                                </span>
                              )}
                            </label>
                          )})}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Columns */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gv-text">{t('table.col_def')}</label>
          </div>

          <div className="space-y-4">
            {columns.map((col, i) => (
              <React.Fragment key={col.id}>
              <div
                className="card p-4 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-gv-pink/20 to-gv-green/20 flex items-center justify-center text-xs text-gv-text-muted font-mono border border-gv-border/50">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={col.name}
                    onChange={(e) => updateCol(col.id, { name: e.target.value })}
                    placeholder={t('table.col_name')}
                    className="flex-1 input-field py-2 text-sm"
                  />
                  <select
                    value={col.type}
                    onChange={(e) => updateCol(col.id, { type: e.target.value as ColumnType })}
                    className="w-44 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink"
                  >
                    {COLUMN_TYPES.map(ct => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </select>
                  {columns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeColumn(col.id)}
                      className="text-gv-pink/60 hover:text-gv-pink p-1 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Type-specific fields */}
                {col.type === 'text' && (
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">生成提示词 (描述LLM应如何生成此列的数据)</label>
                    <textarea
                      value={col.llmPrompt || ''}
                      onChange={(e) => updateCol(col.id, { llmPrompt: e.target.value })}
                      placeholder="例如：生成一个中文姓名，包含姓和名..."
                      rows={2}
                      className="input-field w-full py-2 text-sm"
                    />
                  </div>
                )}

                {col.type === 'number' && (
                  <div className="space-y-2">
                    <select value={col.foreignTable || ''} onChange={(e) => updateCol(col.id, { foreignTable: e.target.value || undefined })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">引用外表（用于跨表公式，可选）</option>
                      {existingTables.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    {col.foreignTable && (
                      <div className="flex gap-2">
                        <select value={col.localMatchColumn || ''} onChange={(e) => updateCol(col.id, { localMatchColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-xs focus:outline-none focus:border-gv-pink">
                          <option value="">本表关联列（自动）</option>
                          {columns.filter(c => c.name.trim()).map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                        <select value={col.foreignColumn || ''} onChange={(e) => updateCol(col.id, { foreignColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-xs focus:outline-none focus:border-gv-pink">
                          <option value="">外表关联列（默认 id）</option>
                          {existingTables.find(t => t.id === col.foreignTable)?.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                      </div>
                    )}
                    <label className="block text-xs text-gv-text-dim">规则描述</label>
                    <div className="flex gap-2">
                      <input type="text" value={col.llmPrompt || ''} onChange={(e) => updateCol(col.id, { llmPrompt: e.target.value })}
                        placeholder="描述你要的数字规则，如：中国随机纬度"
                        className="flex-1 input-field py-1.5 text-xs" />
                      <button type="button"
                        onClick={async () => {
                          if (!col.llmPrompt?.trim()) return
                          updateCol(col.id, { generationCode: '生成中...' })
                          const { llmGenerateCode } = await import('@/services/data-gen')
                          const result = await llmGenerateCode(col.llmPrompt!.trim(), 'number')
                          updateCol(col.id, { generationCode: result.code || `// ${result.error || '生成失败'}` })
                        }}
                        disabled={!col.llmPrompt?.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gv-pink/30 text-gv-pink hover:bg-gv-pink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                        AI 生成代码
                      </button>
                    </div>
                    <label className="block text-xs text-gv-text-dim">JavaScript 代码（可手写或 AI 生成）</label>
                    <textarea
                      value={col.generationCode || ''}
                      onChange={(e) => updateCol(col.id, { generationCode: e.target.value })}
                      placeholder="index, totalRows, previousValues, refData, randomInt(min,max), randomFloat(min,max), pick(arr)"
                      rows={4}
                      className="input-field w-full py-2 text-sm font-mono"
                    />
                    {col.generationCode && col.generationCode !== '生成中...' && (
                      <button type="button"
                        onClick={() => {
                          try {
                            const results = previewGenerationExpression(col.generationCode!)
                            alert(`测试结果（5条）:\n${results.map((v, i) => `  [${i}] ${v}`).join('\n')}`)
                          } catch (err) {
                            alert(`代码错误: ${err instanceof Error ? err.message : String(err)}`)
                          }
                        }}
                        className="text-xs text-gv-pink hover:text-gv-pink-dark transition-colors">
                        测试代码（预览5条）
                      </button>
                    )}
                  </div>
                )}

                {(col.type === 'foreign_key' || col.type === 'foreign_key_array') && (
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-gv-text-dim mb-1">引用表</label>
                      <select
                        value={col.foreignTable || ''}
                        onChange={(e) => updateCol(col.id, { foreignTable: e.target.value })}
                        className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink"
                      >
                        <option value="">选择表...</option>
                        {existingTables.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gv-text-dim mb-1">引用列 (可选)</label>
                      <select
                        value={col.foreignColumn || ''}
                        onChange={(e) => updateCol(col.id, { foreignColumn: e.target.value })}
                        className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink"
                      >
                        <option value="">自动匹配</option>
                        {(() => {
                          const ft = existingTables.find(t => t.id === col.foreignTable)
                          if (!ft) return null
                          return ft.columns.map(c => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))
                        })()}
                      </select>
                    </div>
                  </div>
                )}

                {col.type === 'date' && (
                  <div className="space-y-3">
                    <select value={col.foreignTable || ''} onChange={(e) => updateCol(col.id, { foreignTable: e.target.value || undefined })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">引用外表（用于跨表公式，可选）</option>
                      {existingTables.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    {col.foreignTable && (
                      <div className="flex gap-2">
                        <select value={col.localMatchColumn || ''} onChange={(e) => updateCol(col.id, { localMatchColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-xs focus:outline-none focus:border-gv-pink">
                          <option value="">本表关联列（自动）</option>
                          {columns.filter(c => c.name.trim()).map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                        <select value={col.foreignColumn || ''} onChange={(e) => updateCol(col.id, { foreignColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-xs focus:outline-none focus:border-gv-pink">
                          <option value="">外表关联列（默认 id）</option>
                          {existingTables.find(t => t.id === col.foreignTable)?.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                      </div>
                    )}
                    {col.foreignTable && (
                      <select value={col.parentDateColumn || ''} onChange={(e) => updateCol(col.id, { parentDateColumn: e.target.value || undefined })}
                        className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                        <option value="">选择外表日期字段（手动写公式则留空）</option>
                        {existingTables.find(t => t.id === col.foreignTable)?.columns.filter(c => c.type === 'date').map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                      </select>
                    )}
                    <select value={col.dateFormat || 'date'} onChange={(e) => updateCol(col.id, { dateFormat: e.target.value as DateFormat })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      {DATE_FORMATS.map(f => (<option key={f.value} value={f.value}>{f.label}</option>))}
                    </select>
                    <div>
                      <p className="text-xs text-gv-text-dim mb-1">时间分布比例（%）</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {ensureDateDistribution(col).map((range, ri) => (
                          <div key={ri} className="flex items-center gap-1.5">
                            <span className="text-xs text-gv-text-dim w-20 flex-shrink-0">{range.label}</span>
                            <input
                              type="number" min={0} max={100}
                              value={range.ratio}
                              onChange={(e) => {
                                const dist = [...ensureDateDistribution(col)]
                                dist[ri] = { ...dist[ri], ratio: Number(e.target.value) || 0 }
                                updateCol(col.id, { dateDistribution: dist })
                              }}
                              className="flex-1 input-field py-1 text-xs min-w-0"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input type="text" value={col.llmPrompt || ''} onChange={(e) => updateCol(col.id, { llmPrompt: e.target.value })}
                        placeholder="描述日期规则，如：最近30天随机日期"
                        className="flex-1 input-field py-1.5 text-xs" />
                      <button type="button"
                        onClick={async () => {
                          if (!col.llmPrompt?.trim()) return
                          updateCol(col.id, { generationCode: '生成中...' })
                          const { llmGenerateCode } = await import('@/services/data-gen')
                          const result = await llmGenerateCode(col.llmPrompt!.trim(), 'date', { dateFormat: col.dateFormat, dateDistribution: col.dateDistribution })
                          updateCol(col.id, { generationCode: result.code || `// ${result.error || '生成失败'}` })
                        }}
                        disabled={!col.llmPrompt?.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gv-pink/30 text-gv-pink hover:bg-gv-pink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                        AI 生成代码
                      </button>
                    </div>
                    <input type="text" value={col.generationCode || ''} onChange={(e) => updateCol(col.id, { generationCode: e.target.value })}
                      placeholder="JavaScript 代码，可手写或 AI 生成"
                      className="input-field w-full py-2 text-xs font-mono" />
                    {col.generationCode && col.generationCode !== '生成中...' && (
                      <button type="button"
                        onClick={() => {
                          try {
                            const results = previewGenerationExpression(col.generationCode!)
                            alert(`测试结果（5条）:\n${results.map((v, i) => `  [${i}] ${v}`).join('\n')}`)
                          } catch (err) {
                            alert(`代码错误: ${err instanceof Error ? err.message : String(err)}`)
                          }
                        }}
                        className="text-xs text-gv-pink hover:text-gv-pink-dark transition-colors">
                        测试代码（预览5条）
                      </button>
                    )}
                  </div>
                )}

                {col.type === 'boolean' && (
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">生成代码 (可选，返回值转布尔)</label>
                    <textarea
                      value={col.generationCode || ''}
                      onChange={(e) => updateCol(col.id, { generationCode: e.target.value })}
                      placeholder="留空则随机生成 true/false"
                      rows={2}
                      className="input-field w-full py-2 text-sm font-mono"
                    />
                    <div className="flex items-center gap-2 mt-2 pl-1">
                      <span className="text-xs text-gv-text-muted w-16">True 占比</span>
                      <input
                        type="range"
                        min={0} max={100}
                        value={col.boolTrueRatio ?? 50}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => updateCol(col.id, { boolTrueRatio: Number(e.target.value) })}
                        className="flex-1 accent-gv-pink h-1"
                      />
                      <span className="text-xs font-mono text-gv-text w-9 text-right">{col.boolTrueRatio ?? 50}%</span>
                    </div>
                  </div>
                )}

                {col.type === 'id' && (
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">ID 格式</label>
                    <select value={col.idFormat || 'uuid4'} onChange={(e) => updateCol(col.id, { idFormat: e.target.value as IdFormat })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      {ID_FORMATS.map(f => (<option key={f.value} value={f.value}>{f.label}</option>))}
                    </select>
                  </div>
                )}

                {col.type === 'phone' && (
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">国家</label>
                    <select value={col.phoneCountry || 'CN'} onChange={(e) => updateCol(col.id, { phoneCountry: e.target.value as PhoneCountry })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      {PHONE_COUNTRIES.map(c => (<option key={c.value} value={c.value}>{c.label}</option>))}
                    </select>
                  </div>
                )}

                {col.type === 'city' && (
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">国家</label>
                    <select value={col.cityCountry || 'CN'} onChange={(e) => updateCol(col.id, { cityCountry: e.target.value as PhoneCountry })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      {PHONE_COUNTRIES.map(c => (<option key={c.value} value={c.value}>{c.label}</option>))}
                    </select>
                  </div>
                )}
                {/* Nullable setting for all column types */}
                <div className="border-t border-gv-border/50 pt-2 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={col.nullable || false}
                      onChange={(e) => updateCol(col.id, {
                        nullable: e.target.checked,
                        nullRatio: e.target.checked ? (col.nullRatio ?? 5) : undefined,
                      })}
                      className="rounded accent-gv-pink"
                    />
                    <span className="text-xs text-gv-text-dim">允许空值 (null)</span>
                  </label>
                  {col.nullable && (
                    <div className="flex items-center gap-2 mt-2 pl-1">
                      <span className="text-xs text-gv-text-muted w-10">比例</span>
                      <input
                        type="range"
                        min={0} max={100}
                        value={col.nullRatio ?? 5}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => updateCol(col.id, { nullRatio: Number(e.target.value) })}
                        className="flex-1 accent-gv-pink h-1"
                      />
                      <span className="text-xs font-mono text-gv-text w-9 text-right">{col.nullRatio ?? 5}%</span>
                    </div>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => addColumn(i)}
                className="w-full mt-1 mb-1 rounded-lg border-2 border-dashed border-gv-border hover:border-gv-pink/50 py-2 text-sm text-gv-text-dim hover:text-gv-pink transition-colors"
                title="在此处插入新列">
                + 插入列
              </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-gv-pink/10 border border-gv-pink/30 p-3 text-sm text-gv-pink-dark">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary w-full rounded-lg px-4 py-3 text-sm"
        >
          {t('table.create_btn')}
        </button>
      </form>
    </main>
  )
}
