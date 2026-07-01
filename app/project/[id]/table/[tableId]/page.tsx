'use client'

import React from 'react'
import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import { useParams } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import type { ColumnDef, ColumnType, IdFormat, DateFormat, DateRange, PhoneCountry } from '@/services/types'
import { generateColumn } from '@/services/data-gen'
import { exportSql, exportJson, exportCsv, exportXml, exportExcel, downloadFile } from '@/services/export'
import { computeColumnStats, type ColumnStats, type NumStats, type TextStats, type DateStats, type BoolStats, type IdStats, type FkStats, type PhoneStats, type CityStats } from '@/services/stats'

let _colIdCounter = Date.now()
function genColId(): string { return 'col_' + (_colIdCounter++).toString(36) }

const COLUMN_TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: '文本 (LLM)' },
  { value: 'number', label: '数字 (代码)' },
  { value: 'boolean', label: '布尔值' },
  { value: 'date', label: '日期' },
  { value: 'id', label: 'ID (自增/雪花)' },
  { value: 'phone', label: '电话' },
  { value: 'city', label: '城市' },
  { value: 'foreign_key', label: '外键' },
  { value: 'foreign_key_array', label: '外键数组' },
]

const TYPE_LABEL: Record<ColumnType, string> = {
  text: '文本', number: '数字', boolean: '布尔值', date: '日期',
  id: 'ID', phone: '电话', city: '城市', foreign_key: '外键',
  foreign_key_array: '外键数组',
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
        // Already small enough, just read as data URL
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

function ensureDateDistribution(col: ColumnDef): DateRange[] {
  if (!col.dateDistribution || col.dateDistribution.length === 0) {
    const dist = PRESET_DATE_RANGES.map(r => ({ ...r, ratio: 0 }))
    col.dateDistribution = dist
    return dist
  }
  return col.dateDistribution
}

export default function TableEditorPage() {
  const { id, tableId } = useParams<{ id: string; tableId: string }>()
  const { projects, getTables, updateTable, setTableRows } = useStore()
  const { t } = useLang()
  const project = projects.find(p => p.id === id)
  const tables = getTables(id)
  const table = tables.find(t => t.id === tableId)
  const allTables = tables

  const [rowCount, setRowCount] = useState(10)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [columnGenerating, setColumnGenerating] = useState<string | null>(null)
  const [colDragIdx, setColDragIdx] = useState<number | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [displayedRows, setDisplayedRows] = useState<Record<string, unknown>[]>(table?.rows || [])
  const [pageSize, setPageSize] = useState(50)
  const [currentPage, setCurrentPage] = useState(1)
  const [generatedColumns, setGeneratedColumns] = useState<Set<string>>(new Set())

  const [llmConfigured, setLlmConfigured] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)
  const [importingNuwa, setImportingNuwa] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nuwaFileRef = useRef<HTMLInputElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showExportMenu])

  const handleExportNuwa = async () => {
    const all = getTables(id)
    const tablesWithData = await Promise.all(
      all.map(async (t) => {
        try {
          const res = await fetch(`/api/data?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(t.name)}`)
          if (res.ok) {
            const { rows } = await res.json() as { rows: Record<string, unknown>[] }
            return { ...t, rows }
          }
        } catch {}
        return t
      })
    )
    const nuwaData = { version: 1, project: { id, name: project?.name || '', createdAt: project?.createdAt || '' }, tables: tablesWithData }
    const blob = new Blob([JSON.stringify(nuwaData, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${table.id}.nuwa`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }

  const handleImportNuwa = async (file: File) => {
    setGenError('')
    setImportingNuwa(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.tables) throw new Error('无效的 .nuwa 文件格式')
      for (const nuwaTable of data.tables) {
        const localTable = allTables.find(t => t.name === nuwaTable.name)
        if (!localTable) continue
        if (nuwaTable.rows && nuwaTable.rows.length > 0) {
          await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: id,
              tableName: localTable.name,
              columns: localTable.columns,
              rows: nuwaTable.rows,
            }),
          })
        }
      }
      // Reload displayed rows for current table
      const currentNuwa = data.tables.find((t: { name: string }) => t.name === table?.name)
      if (currentNuwa?.rows) {
        setDisplayedRows(currentNuwa.rows)
        setTableRows(id, table!.id, currentNuwa.rows)
        setGeneratedColumns(new Set(table!.columns.map(c => c.id)))
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImportingNuwa(false)
    }
  }

  useEffect(() => {
    fetch('/api/llm/config')
      .then(r => r.json())
      .then(data => setLlmConfigured(data.configured))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!table) return
    const url = `/api/data?projectId=${id}&tableName=${encodeURIComponent(table.name)}`
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (data.rows?.length > 0) {
          setDisplayedRows(data.rows)
        }
      })
      .catch(() => {})
  }, [id, table?.name])

  const [editMode, setEditMode] = useState(false)
  const [editName, setEditName] = useState(table?.name || '')
  const [editColumns, setEditColumns] = useState<ColumnDef[]>(table?.columns || [])
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  if (!project || !table) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gv-text-dim">数据表不存在</p>
          <Link href={`/project/${id}`} className="text-sm text-gv-pink hover:underline mt-2 inline-block">
            返回项目
          </Link>
        </div>
      </div>
    )
  }

  const emptyPromptCols = table.columns.filter(c => c.type === 'text' && !c.nullable && !c.llmPrompt?.trim())

  const handleGenerate = async () => {
    setGenError('')
    setGenerating(true)
    try {
      // Create blank rows (all nulls) — user will fill column by column
      const blankRows: Record<string, unknown>[] = []
      for (let i = 0; i < rowCount; i++) {
        const row: Record<string, unknown> = {}
        for (const col of table.columns) {
          row[col.name] = null
        }
        blankRows.push(row)
      }

      await saveToParquet(blankRows)

      setTableRows(id, table.id, blankRows)
      setDisplayedRows(blankRows)
      setGeneratedColumns(new Set())
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const saveToParquet = async (rows: Record<string, unknown>[]) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: id,
        tableName: table.name,
        columns: table.columns,
        rows,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(`保存数据失败: ${data.error || res.status}`)
    }
  }

  const handleGenerateColumn = async (col: ColumnDef) => {
    setGenError('')
    if (col.type === 'text' && !col.nullable && !col.llmPrompt?.trim()) {
      setGenError(`列"${col.name}"的提示词为空，请补充提示词或勾选"允许空值"`)
      return
    }
    setColumnGenerating(col.id)
    try {
      const refData: Record<string, Record<string, unknown>[]> = {}
      // Build refData for columns that reference another table (foreign_key or non-fk with foreignTable)
      if (col.foreignTable) {
        const parentTable = allTables.find(t => t.id === col.foreignTable || t.name === col.foreignTable)
        if (!parentTable) {
          throw new Error(`引用的表"${col.foreignTable}"不存在`)
        }
        if (parentTable.rows.length > 0) {
          refData[parentTable.id] = parentTable.rows
          refData[parentTable.name] = parentTable.rows
        } else {
          // Try loading from Parquet
          try {
            const url = `/api/data/fk-values?projectId=${encodeURIComponent(id)}&tableId=${encodeURIComponent(parentTable.name)}&column=*`
            const res = await fetch(url)
            if (res.ok) {
              const { rows: parquetRows } = await res.json() as { rows: Record<string, unknown>[] }
              if (parquetRows && parquetRows.length > 0) {
                refData[parentTable.id] = parquetRows
                refData[parentTable.name] = parquetRows
              }
            }
          } catch {
            // Parquet not available
          }
          if (!refData[parentTable.name] || refData[parentTable.name].length === 0) {
            throw new Error(`引用的表"${parentTable.name}"还没有数据，请先生成该表的数据`)
          }
        }
      }

      const rowCount = displayedRows.length > 0 ? displayedRows.length : 10
      // Build columnResults from already-generated columns (those before this one)
      const columnResults: Record<string, unknown[]> = {}
      const colIndex = table.columns.indexOf(col)
      for (let j = 0; j < colIndex; j++) {
        const prevCol = table.columns[j]
        columnResults[prevCol.name] = displayedRows.map(r => r[prevCol.name])
      }
      const values = await generateColumn(col, rowCount, refData, columnResults)

      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < rowCount; i++) {
        const existing = displayedRows[i] || {}
        rows.push({ ...existing, [col.name]: values[i] ?? null })
      }

      setDisplayedRows(rows)
      setTableRows(id, table.id, rows)
      await saveToParquet(rows)
      setGeneratedColumns(prev => new Set(prev).add(col.id))
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setColumnGenerating(null)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setGenError('图片大小不能超过 10MB')
      return
    }
    setImageUploading(true)
    setGenError('')
    try {
      const base64 = await resizeImage(file)
      const { callLlmVision } = await import('@/services/llm')
      const raw = await callLlmVision(VISION_SYSTEM_PROMPT, '请识别图片中的表格列结构', [base64])
      const parsed = extractJsonArray(raw)
      if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
        setGenError('未能从图片中识别出有效的列结构。请确保图片包含表格信息。')
        return
      }
      const newCols: ColumnDef[] = parsed.map((item: Record<string, unknown>) => ({
        id: genColId(),
        name: (item.name as string) || 'unnamed',
        type: (item.type as ColumnType) || 'text',
        llmPrompt: (item.llmPrompt as string) || '',
        generationCode: '',
      }))
      setEditColumns(newCols)
      updateTable(id, table.id, { columns: newCols })
      setEditMode(true)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '图片识别失败')
    } finally {
      setImageUploading(false)
    }
  }

  const handleColDragStart = (i: number) => setColDragIdx(i)

  const handleColDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    if (colDragIdx === null || colDragIdx === i) return
    const reordered = [...table.columns]
    const [moved] = reordered.splice(colDragIdx, 1)
    reordered.splice(i, 0, moved)
    updateTable(id, table.id, { columns: reordered })
    setColDragIdx(i)
  }

  const handleColDragEnd = () => setColDragIdx(null)

  const startEdit = () => {
    setEditName(table.name)
    setEditColumns(JSON.parse(JSON.stringify(table.columns)))
    setEditMode(true)
  }

  const saveEdit = () => {
    const invalid = editColumns.find(c => !c.name.trim())
    if (invalid) return
    updateTable(id, table.id, { name: editName, columns: editColumns })
    setEditMode(false)
    // Schema changed — reset generate button state
    setGeneratedColumns(new Set())
  }

  const updateEditCol = (colId: string, updates: Partial<ColumnDef>) => {
    setEditColumns(prev => prev.map(c => (c.id === colId ? { ...c, ...updates } : c)))
  }

  const addEditColumn = (afterIndex?: number) => {
    setEditColumns(prev => {
      if (afterIndex !== undefined && afterIndex >= 0 && afterIndex < prev.length) {
        return [...prev.slice(0, afterIndex + 1), emptyColumn(), ...prev.slice(afterIndex + 1)]
      }
      return [...prev, emptyColumn()]
    })
  }

  const removeEditColumn = (colId: string) => {
    if (editColumns.length <= 1) return
    setEditColumns(prev => prev.filter(c => c.id !== colId))
  }

  const handleDragStart = (i: number) => setDragIndex(i)

  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === i) return
    const reordered = [...editColumns]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(i, 0, moved)
    setEditColumns(reordered)
    setDragIndex(i)
  }

  const handleDragEnd = () => setDragIndex(null)

  const hasUnresolvedFK = table.columns.some(
    c => (c.type === 'foreign_key' || c.type === 'foreign_key_array') && c.foreignTable && !allTables.find(t => t.id === c.foreignTable)
  )

  return (
    <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/project/${id}`} className="text-gv-text-dim hover:text-gv-pink transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h2 className="text-lg font-semibold text-gv-text">{table.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* image recognition hidden */}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
          <input ref={nuwaFileRef} type="file" accept=".nuwa" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportNuwa(f); if (nuwaFileRef.current) nuwaFileRef.current.value = '' }} />
          <button onClick={() => nuwaFileRef.current?.click()} disabled={importingNuwa}
            className="btn-outline rounded-lg px-3 py-1.5 text-sm inline-flex items-center gap-1 disabled:opacity-50">
            {importingNuwa ? (
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            )}
            导入 .nuwa
          </button>
          <div className="relative">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowExportMenu(!showExportMenu)} disabled={displayedRows.length === 0}
              className="btn-outline rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {t('table.export_menu')}
            </button>
            {showExportMenu && (
              <div ref={exportMenuRef} className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-gv-border bg-white shadow-lg z-10 overflow-hidden">
                <button onClick={() => { downloadFile(exportJson(table), `${table.name}.json`, 'application/json'); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-gv-pink/5 transition-colors">JSON</button>
                <button onClick={() => { downloadFile(exportCsv(table), `${table.name}.csv`, 'text/csv'); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-gv-pink/5 transition-colors">CSV</button>
                <button onClick={() => { downloadFile(exportExcel(table), `${table.name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-gv-pink/5 transition-colors">Excel (XLSX)</button>
                <button onClick={() => { downloadFile(exportXml(table), `${table.name}.xml`, 'application/xml'); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-gv-pink/5 transition-colors">XML</button>
                <button onClick={() => { downloadFile(exportSql(table), `${table.name}.sql`, 'text/plain'); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-gv-pink/5 transition-colors">SQL INSERT</button>
                <a href={`/api/data/download?projectId=${id}&tableName=${encodeURIComponent(table.name)}`} onClick={() => setShowExportMenu(false)}
                  className="block w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-gv-pink/5 transition-colors">Parquet</a>
                <button onClick={() => { handleExportNuwa(); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-gv-pink/5 transition-colors border-t border-gv-border/50">导出 .nuwa</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6 items-start">
        {/* LEFT 1/4 — Column schema + edit */}
        <div className="w-1/4 flex-shrink-0 space-y-4">

      {editMode ? (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gv-text text-sm">{t('table.edit_schema')}</h3>
            <button onClick={() => setEditMode(false)} className="text-gv-text-dim hover:text-gv-pink transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gv-text-dim mb-1">{t('table.name')}</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                className="input-field w-full py-2 text-sm" />
            </div>
            {editColumns.map((col, i) => (
              <React.Fragment key={col.id}>
              <div
                className={`rounded-lg border p-3 space-y-2 transition-all duration-200 ${
                  dragIndex === i ? 'opacity-50 border-gv-pink shadow-[0_0_16px_var(--color-gv-pink-glow)]' : 'border-gv-border'
                }`}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragEnd={handleDragEnd}
              >
                <div className="flex items-center gap-2">
                  <div className="cursor-grab active:cursor-grabbing text-gv-text-muted hover:text-gv-pink select-none transition-colors" title="拖动排序">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                    </svg>
                  </div>
                  <span className="text-xs text-gv-text-muted w-5">{i + 1}</span>
                  <div className="flex-1 flex flex-col gap-2">
                    <input type="text" value={col.name} onChange={(e) => updateEditCol(col.id, { name: e.target.value })}
                      placeholder={t('table.col_name')}
                      className="w-full input-field py-2 text-sm" />
                    <select value={col.type} onChange={(e) => updateEditCol(col.id, { type: e.target.value as ColumnType })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      {COLUMN_TYPES.map(ct => (<option key={ct.value} value={ct.value}>{ct.label}</option>))}
                    </select>
                  </div>
                  {editColumns.length > 1 && (
                    <button onClick={() => removeEditColumn(col.id)} className="text-gv-pink/60 hover:text-gv-pink p-1 transition-colors"
                      title={t('app.delete')}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
                {col.type === 'text' && (
                  <textarea value={col.llmPrompt || ''} onChange={(e) => updateEditCol(col.id, { llmPrompt: e.target.value })}
                    placeholder="描述如何生成此列文本..."
                    rows={2}
                    className="input-field w-full py-2 text-sm" />
                )}
                {col.type === 'number' && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input type="text" value={col.llmPrompt || ''} onChange={(e) => updateEditCol(col.id, { llmPrompt: e.target.value })}
                        placeholder="描述你要的数字规则，如：中国随机纬度"
                        className="flex-1 input-field py-1.5 text-xs" />
                      <button type="button"
                        onClick={async () => {
                          if (!col.llmPrompt?.trim()) return
                          updateEditCol(col.id, { generationCode: '生成中...' })
                          const { llmGenerateCode } = await import('@/services/data-gen')
                          const result = await llmGenerateCode(col.llmPrompt!.trim(), 'number')
                          updateEditCol(col.id, { generationCode: result.code || `// ${result.error || '生成失败'}` })
                        }}
                        disabled={!col.llmPrompt?.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gv-pink/30 text-gv-pink hover:bg-gv-pink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                        AI 生成代码
                      </button>
                    </div>
                    <textarea value={col.generationCode || ''} onChange={(e) => updateEditCol(col.id, { generationCode: e.target.value })}
                      placeholder="JavaScript 代码，返回值作为列值。可手写或点上方 AI 生成。"
                      rows={3}
                      className="input-field w-full py-2 text-sm font-mono" />
                    {col.generationCode && col.generationCode !== '生成中...' && (
                      <button type="button"
                        onClick={() => {
                          try {
                            const testRefData = { users: [{ id: 1, name: 'test' }], orders: [{ id: 1 }], products: [{ id: 1 }] }
                            const testPick = (arr: unknown[]) => (Array.isArray(arr) && arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : undefined)
                            const testRandomInt = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a
                            const testRandomFloat = (a: number, b: number) => Math.random() * (b - a) + a
                            const testRow = new Proxy({}, { get: () => new Date() })
                            const fn = new Function('index', 'totalRows', 'previousValues', 'refData', 'row', 'randomInt', 'randomFloat', 'pick',
                              col.generationCode!.includes('return ') ? col.generationCode! : `return (${col.generationCode})`)
                            const results: unknown[] = []
                            for (let i = 0; i < 5; i++) {
                              results.push(fn(i, 5, results, testRefData, testRow, testRandomInt, testRandomFloat, testPick))
                            }
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
                  <div className="space-y-2">
                    <select value={col.foreignTable || ''} onChange={(e) => updateEditCol(col.id, { foreignTable: e.target.value })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">选择引用表...</option>
                      {allTables.filter(t => t.id !== table.id).map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    <select value={col.foreignColumn || ''} onChange={(e) => updateEditCol(col.id, { foreignColumn: e.target.value })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">自动匹配列</option>
                      {allTables.find(t => t.id === col.foreignTable)?.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                    </select>
                  </div>
                )}
                {col.type === 'date' && (
                  <div className="space-y-3">
                    <select value={col.dateFormat || 'date'} onChange={(e) => updateEditCol(col.id, { dateFormat: e.target.value as DateFormat })}
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
                                updateEditCol(col.id, { dateDistribution: dist })
                              }}
                              className="flex-1 input-field py-1 text-xs min-w-0"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input type="text" value={col.llmPrompt || ''} onChange={(e) => updateEditCol(col.id, { llmPrompt: e.target.value })}
                        placeholder="描述日期规则，如：最近30天随机日期"
                        className="flex-1 input-field py-1.5 text-xs" />
                      <button type="button"
                        onClick={async () => {
                          if (!col.llmPrompt?.trim()) return
                          updateEditCol(col.id, { generationCode: '生成中...' })
                          const { llmGenerateCode } = await import('@/services/data-gen')
                          const result = await llmGenerateCode(col.llmPrompt!.trim(), 'date', { dateFormat: col.dateFormat, dateDistribution: col.dateDistribution })
                          updateEditCol(col.id, { generationCode: result.code || `// ${result.error || '生成失败'}` })
                        }}
                        disabled={!col.llmPrompt?.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gv-pink/30 text-gv-pink hover:bg-gv-pink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                        AI 生成代码
                      </button>
                    </div>
                    <input type="text" value={col.generationCode || ''} onChange={(e) => updateEditCol(col.id, { generationCode: e.target.value })}
                      placeholder="JavaScript 代码，可手写或点上方 AI 生成"
                      className="input-field w-full py-2 text-xs font-mono" />
                    {col.generationCode && col.generationCode !== '生成中...' && (
                      <button type="button"
                        onClick={() => {
                          try {
                            const testRefData = { users: [{ id: 1, name: 'test' }], orders: [{ id: 1 }], products: [{ id: 1 }] }
                            const testPick = (arr: unknown[]) => (Array.isArray(arr) && arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : undefined)
                            const testRandomInt = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a
                            const testRandomFloat = (a: number, b: number) => Math.random() * (b - a) + a
                            const testRow = new Proxy({}, { get: () => new Date() })
                            const fn = new Function('index', 'totalRows', 'previousValues', 'refData', 'row', 'randomInt', 'randomFloat', 'pick',
                              col.generationCode!.includes('return ') ? col.generationCode! : `return (${col.generationCode})`)
                            const results: unknown[] = []
                            for (let i = 0; i < 5; i++) {
                              results.push(fn(i, 5, results, testRefData, testRow, testRandomInt, testRandomFloat, testPick))
                            }
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
                  <input type="text" value={col.generationCode || ''} onChange={(e) => updateEditCol(col.id, { generationCode: e.target.value })}
                    placeholder="可选，留空随机 true/false"
                    className="input-field w-full py-2 text-sm font-mono" />
                )}
                {col.type === 'id' && (
                  <select value={col.idFormat || 'uuid4'} onChange={(e) => updateEditCol(col.id, { idFormat: e.target.value as IdFormat })}
                    className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                    {ID_FORMATS.map(f => (<option key={f.value} value={f.value}>{f.label}</option>))}
                  </select>
                )}
                {col.type === 'phone' && (
                  <select value={col.phoneCountry || 'CN'} onChange={(e) => updateEditCol(col.id, { phoneCountry: e.target.value as PhoneCountry })}
                    className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                    {PHONE_COUNTRIES.map(c => (<option key={c.value} value={c.value}>{c.label}</option>))}
                  </select>
                )}
                {col.type === 'city' && (
                  <select value={col.cityCountry || 'CN'} onChange={(e) => updateEditCol(col.id, { cityCountry: e.target.value as PhoneCountry })}
                    className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                    {PHONE_COUNTRIES.map(c => (<option key={c.value} value={c.value}>{c.label}</option>))}
                  </select>
                )}
                {/* Nullable setting for all column types */}
                <div className="border-t border-gv-border/50 pt-2 mt-2" draggable="false" onDragStart={(e) => e.stopPropagation()}>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={col.nullable || false}
                      onChange={(e) => updateEditCol(col.id, {
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
                        onDragStart={(e) => e.stopPropagation()}
                        onChange={(e) => updateEditCol(col.id, { nullRatio: Number(e.target.value) })}
                        className="flex-1 accent-gv-pink h-1"
                      />
                      <span className="text-xs font-mono text-gv-text w-9 text-right">{col.nullRatio ?? 5}%</span>
                    </div>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => addEditColumn(i)}
                className="w-full mt-1 mb-1 rounded-lg border-2 border-dashed border-gv-border hover:border-gv-pink/50 py-2 text-sm text-gv-text-dim hover:text-gv-pink transition-colors"
                title="在此处插入新列">
                + 插入列
              </button>
              </React.Fragment>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={saveEdit}
              className="btn-primary rounded-lg px-4 py-2 text-sm">{t('table.save_changes')}</button>
            <button onClick={() => setEditMode(false)}
              className="btn-outline rounded-lg px-4 py-2 text-sm">{t('table.discard_changes')}</button>
          </div>
        </div>
      ) : (
        /* Column Info (read-only) */
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gv-text">
              列结构
              {displayedRows.length > 0 && (
                <span className="ml-2 text-xs font-normal text-gv-text-dim">
                  (已生成 {generatedColumns.size}/{table.columns.length} 列)
                </span>
              )}
            </h3>
            <button onClick={startEdit}
              className="btn-outline rounded-lg px-2.5 py-1 text-xs">
              {t('table.edit_schema')}
            </button>
          </div>
        <div className="space-y-1">
          {table.columns.map((col, i) => (
            <div key={col.id}
              draggable={!editMode}
              onDragStart={() => handleColDragStart(i)}
              onDragOver={(e) => handleColDragOver(e, i)}
              onDragEnd={handleColDragEnd}
              className={`flex items-center gap-2 text-sm p-1.5 -mx-1.5 rounded transition-colors ${
                colDragIdx === i ? 'opacity-50 bg-gv-pink/5' : ''
              }`}
            >
              {/* Col 1: drag handle */}
              <div className="cursor-grab active:cursor-grabbing text-gv-text-muted hover:text-gv-pink select-none flex-shrink-0 transition-colors" title={t('project.drag_hint')}>
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                </svg>
              </div>
              {/* Col 2: name + type stacked */}
              <div className="flex flex-col gap-0.5 flex-shrink-0 min-w-[60px]">
                <span className="font-medium text-gv-text text-xs">{col.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium self-start ${
                  col.type === 'foreign_key' || col.type === 'foreign_key_array' ? 'bg-gv-pink/10 text-gv-pink' :
                  col.type === 'text' ? 'bg-gv-green/10 text-gv-green-dark' :
                  col.type === 'number' ? 'bg-gv-pink/10 text-gv-pink-dark' :
                  col.type === 'id' ? 'bg-gv-green/10 text-gv-green-dark' :
                  'bg-gv-bg text-gv-text-dim'
                }`}>
                  {TYPE_LABEL[col.type]}
                </span>
              </div>
              {/* Col 3: prompt / code / format info */}
              <div className="flex-1 min-w-0">
                {col.type === 'text' && (
                  col.llmPrompt?.trim()
                    ? <div className="text-xs text-gv-text-dim truncate" title={col.llmPrompt}>{col.llmPrompt}</div>
                    : <div className="text-xs text-gv-pink-dark">{col.nullable ? '允许空值' : '提示词为空'}</div>
                )}
                {col.generationCode && (
                  <div className="text-xs text-gv-text-muted truncate font-mono" title={col.generationCode}>{col.generationCode}</div>
                )}
                {col.type === 'date' && col.dateFormat && col.dateFormat !== 'date' && (
                  <div className="text-xs text-gv-pink font-medium">
                    {DATE_FORMATS.find(f => f.value === col.dateFormat)?.label || col.dateFormat}
                  </div>
                )}
                {col.type === 'id' && (
                  <div className="text-xs text-gv-green-dark font-medium">
                    {ID_FORMATS.find(f => f.value === (col.idFormat || 'uuid4'))?.label || 'UUID v4'}
                  </div>
                )}
                {col.type === 'phone' && (
                  <div className="text-xs text-gv-pink font-medium">
                    {PHONE_COUNTRIES.find(c => c.value === (col.phoneCountry || 'CN'))?.label || '中国 (+86)'}
                  </div>
                )}
                {col.type === 'city' && (
                  <div className="text-xs text-gv-green-dark font-medium">
                    {PHONE_COUNTRIES.find(c => c.value === (col.cityCountry || 'CN'))?.label || '中国'}
                  </div>
                )}
                {col.foreignTable && (
                  <div className="text-xs text-gv-pink truncate">
                    → {allTables.find(t => t.id === col.foreignTable)?.name || col.foreignTable}
                    {col.foreignColumn ? `.${col.foreignColumn}` : ''}
                  </div>
                )}
              </div>
              {/* Col 4: nullable + generate */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {col.nullable && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-gv-pink/10 text-gv-pink font-medium">
                    {col.nullRatio && col.nullRatio > 0 ? `null ${col.nullRatio}%` : 'N'}
                  </span>
                )}
                {generatedColumns.has(col.id) ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-gv-green-dark">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                ) : (
                  <button
                    onClick={() => handleGenerateColumn(col)}
                    disabled={columnGenerating != null}
                    className="rounded-lg border border-gv-border px-1.5 py-0.5 text-xs font-medium text-gv-text-dim hover:text-gv-pink hover:border-gv-pink/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={`生成 ${col.name} 列数据`}
                  >
                    {columnGenerating === col.id ? (
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : t('table.generate')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {hasUnresolvedFK && (
          <p className="text-xs text-gv-pink-dark mt-2">部分外键引用的表尚不存在。</p>
        )}
        {emptyPromptCols.length > 0 && (
          <p className="text-xs text-gv-pink-dark mt-2">
            {emptyPromptCols.map(c => c.name).join(', ')} 的提示词为空，无法生成。请点击"{t('table.edit_schema')}"补充。
          </p>
        )}
      </div>
      )}

      {/* LEFT panel tools */}
      {!editMode && (
        <>
          {hasUnresolvedFK && (
            <p className="text-xs text-gv-pink-dark">部分外键引用的表尚不存在。</p>
          )}
          {emptyPromptCols.length > 0 && (
            <p className="text-xs text-gv-pink-dark">
              {emptyPromptCols.map(c => c.name).join(', ')} 的提示词为空，无法生成。
            </p>
          )}
        </>
      )}
      </div> {/* end left panel */}

      {/* RIGHT 3/4 — Generate + Table */}
      <div className="flex-1 space-y-4">
        {/* Generate Panel */}
        <div className="card p-5">
        <h3 className="text-sm font-semibold text-gv-text mb-4">{t('table.generate')}</h3>

        {table.columns.some(c => c.type === 'text') && (
          !llmConfigured ? (
            <div className="rounded-lg bg-gv-pink/10 border border-gv-pink/30 p-3 mb-4 text-sm text-gv-pink-dark">
              {t('app.unconfigured')}。<Link href="/settings" className="ml-1 underline font-medium">{t('home.settings_hint')}</Link>
            </div>
          ) : (
            <div className="rounded-lg bg-gv-green/10 border border-gv-green/30 p-3 mb-4 text-sm text-gv-green-dark">
              LLM API 已配置，将在生成时调用模型生成文本数据。
            </div>
          )
        )}

        {genError && (
          <div className="rounded-lg bg-gv-pink/10 border border-gv-pink/30 p-3 mb-4 text-sm text-gv-pink-dark whitespace-pre-wrap">
            {genError}
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gv-text-dim">{t('table.row_count')}</label>
            <input type="number" value={rowCount} onChange={(e) => setRowCount(Number(e.target.value))}
              min={1} max={1000}
              className="w-24 input-field py-2 text-sm" />
          </div>
          <button onClick={handleGenerate} disabled={generating}
            className="btn-primary rounded-lg px-6 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {generating ? t('table.generating') : '创建空记录'}
          </button>
          <span className="text-sm text-gv-text-muted">{t('table.rows')}: {displayedRows.length}</span>
        </div>
      </div>

      {/* Stats Panel */}
      {displayedRows.length > 0 && <StatsPanel columns={table.columns} rows={displayedRows} />}

      {/* Data Table */}
      <div className="card overflow-hidden">
        {displayedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gv-text-dim">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gv-pink/10 to-gv-green/10 flex items-center justify-center mb-3 border border-gv-border">
              <svg className="w-6 h-6 text-gv-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 3 4 4 4 7z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 3v18M16 3v18M3 8h18M3 16h18" />
              </svg>
            </div>
            <p>{t('table.no_data')}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gv-border/50 bg-gv-bg/50">
              <div className="flex items-center gap-2 text-xs text-gv-text-dim">
                <span>每页</span>
                {[50, 100].map(n => (
                  <button key={n} onClick={() => { setPageSize(n); setCurrentPage(1) }}
                    className={`px-2 py-0.5 rounded border transition-colors ${pageSize === n ? 'border-gv-pink bg-gv-pink/10 text-gv-pink' : 'border-gv-border hover:border-gv-pink/50'}`}>{n}</button>
                ))}
                <span>行 · 共 {displayedRows.length} 行</span>
              </div>
              {(() => {
                const totalPages = Math.ceil(displayedRows.length / pageSize)
                const start = (currentPage - 1) * pageSize
                const end = Math.min(start + pageSize, displayedRows.length)
                return (
                  <div className="flex items-center gap-1 text-xs text-gv-text-dim">
                    <span>{start + 1}-{end} / {displayedRows.length}</span>
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                      className="px-1.5 py-0.5 rounded border border-gv-border hover:border-gv-pink/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">&lt;</button>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                      className="px-1.5 py-0.5 rounded border border-gv-border hover:border-gv-pink/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">&gt;</button>
                  </div>
                )
              })()}
            </div>
            <div className="relative">
              <div className="overflow-x-auto max-h-[32rem]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-gv-border bg-gradient-to-r from-gv-pink/5 to-gv-green/5 backdrop-blur-sm">
                      <th className="text-left px-4 py-2.5 text-xs text-gv-text-dim font-medium w-10">#</th>
                      {table.columns.map(col => (
                        <th key={col.id} className="text-left px-3 py-2.5 text-xs text-gv-text-dim font-medium whitespace-nowrap">{col.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((row, i) => (
                      <tr key={i} className="border-b border-gv-border/50 hover:bg-gv-pink/[0.03] transition-colors">
                        <td className="px-4 py-2 text-gv-text-muted text-xs">{(currentPage - 1) * pageSize + i + 1}</td>
                        {table.columns.map(col => (
                          <td key={col.id} className="px-3 py-2 max-w-[200px] truncate text-gv-text text-xs">{renderCellValue(row[col.name])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pointer-events-none absolute right-0 top-[2.125rem] bottom-0 w-8 bg-gradient-to-r from-transparent to-gv-bg/60" />
            </div>
          </>
        )}
        </div>
      </div> {/* end right panel */}
    </div> {/* end flex */}
    </main>
  )
}

function StatsPanel({ columns, rows }: { columns: ColumnDef[]; rows: Record<string, unknown>[] }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-lg border-2 border-dashed border-gv-border py-3 text-sm text-gv-text-dim hover:text-gv-pink hover:border-gv-pink/40 transition-colors">
        数据概况
      </button>
    )
  }

  return (
    <div className="mt-4 card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gv-text">数据概况</h3>
        <button onClick={() => setOpen(false)} className="text-gv-text-muted hover:text-gv-pink transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {columns.map(col => {
          const stats = computeColumnStats(col, rows)
          return <StatCard key={col.id} col={col} stats={stats} />
        })}
      </div>
      <button onClick={() => setOpen(false)}
        className="mt-4 w-full rounded-lg border border-gv-border py-2 text-sm text-gv-text-dim hover:text-gv-pink hover:border-gv-pink/40 transition-colors">
        关闭数据概况
      </button>
    </div>
  )
}

function StatCard({ col, stats }: { col: ColumnDef; stats: ColumnStats }) {
  return (
    <div className="rounded-lg border border-gv-border p-3 text-xs bg-gv-bg/50">
      <div className="font-medium text-sm text-gv-text mb-2">{col.name}</div>
      {stats.type === 'number' && <NumStatCard stats={stats} />}
      {stats.type === 'text' && <TextStatCard stats={stats} />}
      {stats.type === 'date' && <DateStatCard stats={stats} />}
      {stats.type === 'boolean' && <BoolStatCard stats={stats} />}
      {stats.type === 'id' && <IdStatCard stats={stats} />}
      {stats.type === 'foreign_key' && <FkStatCard stats={stats} />}
      {stats.type === 'phone' && <PhoneStatCard stats={stats} />}
      {stats.type === 'city' && <CityStatCard stats={stats} />}
      {stats.type === 'unknown' && <p className="text-gv-text-dim">共 {stats.count} 条数据</p>}
    </div>
  )
}

function tinyBar(v: number, max: number) {
  const pct = max > 0 ? Math.round((v / max) * 100) : 0
  return (
    <span className="inline-block h-2 bg-gradient-to-r from-gv-pink to-gv-green rounded-sm ml-1" style={{ width: `${Math.max(pct, 1)}%`, minWidth: pct > 0 ? '4px' : '0' }} />
  )
}

function NumStatCard({ stats }: { stats: NumStats }) {
  const maxHist = Math.max(...stats.histogram.map(h => h.count), 1)
  return (
    <div className="space-y-1.5 text-gv-text-dim">
      <div className="flex justify-between"><span>数量</span><span className="font-mono text-gv-text">{stats.count}</span></div>
      <div className="flex justify-between"><span>均值</span><span className="font-mono text-gv-text">{stats.mean.toFixed(2)}</span></div>
      <div className="flex justify-between"><span>中位数</span><span className="font-mono text-gv-text">{stats.median.toFixed(2)}</span></div>
      <div className="flex justify-between"><span>标准差</span><span className="font-mono text-gv-text">{stats.std.toFixed(2)}</span></div>
      <div className="flex justify-between"><span>最小 / 最大</span><span className="font-mono text-gv-text">{stats.min} / {stats.max}</span></div>
      <div className="flex justify-between"><span>Q1 / Q3</span><span className="font-mono text-gv-text">{stats.q1.toFixed(1)} / {stats.q3.toFixed(1)}</span></div>
      <div className="mt-2">
        <p className="text-gv-text-muted mb-1">分布</p>
        {stats.histogram.map((h, i) => (
          <div key={i} className="flex items-center gap-1 text-xs">
            <span className="w-14 text-right font-mono">{h.binStart}</span>
            <span>-</span>
            <span className="w-14 font-mono">{h.binEnd}</span>
            <span className="font-mono text-gv-text-muted">{h.count}</span>
            {tinyBar(h.count, maxHist)}
          </div>
        ))}
      </div>
    </div>
  )
}

function TextStatCard({ stats }: { stats: TextStats }) {
  const maxW = Math.max(...stats.topWords.map(w => w.count), 1)
  return (
    <div className="space-y-1.5 text-gv-text-dim">
      <div className="flex justify-between"><span>数量</span><span className="font-mono text-gv-text">{stats.count}</span></div>
      <div className="flex justify-between"><span>平均长度</span><span className="font-mono text-gv-text">{stats.avgLength.toFixed(0)} 字符</span></div>
      <div className="flex justify-between"><span>最短 / 最长</span><span className="font-mono text-gv-text">{stats.minLength} / {stats.maxLength}</span></div>
      <div className="flex justify-between"><span>唯一值</span><span className="font-mono text-gv-text">{stats.uniqueCount}</span></div>
      {stats.topWords.length > 0 && (
        <div className="mt-2">
          <p className="text-gv-text-muted mb-1">高频词</p>
          {stats.topWords.map((w, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="font-mono w-20 truncate">{w.word}</span>
              <span className="font-mono text-gv-text-muted">{w.count}</span>
              {tinyBar(w.count, maxW)}
            </div>
          ))}
        </div>
      )}
      {stats.cityWords.length > 0 && (
        <div className="mt-2">
          <p className="text-gv-text-muted mb-1">城市提及</p>
          {stats.cityWords.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="font-mono w-16 truncate text-xs">{c.city}</span>
              <span className="text-xs text-gv-text-muted w-16 truncate">{c.province}</span>
              <span className="font-mono text-gv-text-muted text-xs">{c.count}</span>
              {tinyBar(c.count, Math.max(...stats.cityWords.map(w => w.count), 1))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DateStatCard({ stats }: { stats: DateStats }) {
  const maxM = Math.max(...stats.byMonth.map(m => m.count), 1)
  return (
    <div className="space-y-1.5 text-gv-text-dim">
      <div className="flex justify-between"><span>数量</span><span className="font-mono text-gv-text">{stats.count}</span></div>
      <div className="flex justify-between"><span>最早</span><span className="font-mono text-xs truncate max-w-[140px]">{stats.min}</span></div>
      <div className="flex justify-between"><span>最晚</span><span className="font-mono text-xs truncate max-w-[140px]">{stats.max}</span></div>
      <div className="flex justify-between"><span>跨度</span><span className="font-mono text-gv-text">{stats.spanDays} 天</span></div>
      {stats.byMonth.length > 0 && (
        <div className="mt-2">
          <p className="text-gv-text-muted mb-1">按月分布</p>
          {stats.byMonth.map((m, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="font-mono w-16">{m.month}</span>
              <span className="font-mono text-gv-text-muted">{m.count}</span>
              {tinyBar(m.count, maxM)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BoolStatCard({ stats }: { stats: BoolStats }) {
  return (
    <div className="space-y-1.5 text-gv-text-dim">
      <div className="flex justify-between"><span>数量</span><span className="font-mono text-gv-text">{stats.count}</span></div>
      <div className="flex justify-between"><span>True (1)</span><span className="font-mono text-gv-text">{stats.trueCount}</span></div>
      <div className="flex justify-between"><span>False (0)</span><span className="font-mono text-gv-text">{stats.falseCount}</span></div>
      <div className="flex justify-between"><span>True 占比</span><span className="font-mono text-gv-text">{(stats.trueRatio * 100).toFixed(1)}%</span></div>
      <div className="mt-1 bg-gv-bg rounded-full h-2 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-gv-green to-gv-pink rounded-full transition-all" style={{ width: `${stats.trueRatio * 100}%` }} />
      </div>
    </div>
  )
}

function IdStatCard({ stats }: { stats: IdStats }) {
  return (
    <div className="space-y-1.5 text-gv-text-dim">
      <div className="flex justify-between"><span>数量</span><span className="font-mono text-gv-text">{stats.count}</span></div>
      <div className="flex justify-between"><span>唯一值</span><span className="font-mono text-gv-text">{stats.uniqueCount}</span></div>
      <div className="flex justify-between"><span>重复</span><span className="font-mono text-gv-text">{stats.duplicateCount}</span></div>
      <div className="flex justify-between"><span>唯一率</span><span className="font-mono text-gv-text">{stats.count > 0 ? ((stats.uniqueCount / stats.count) * 100).toFixed(1) : 0}%</span></div>
    </div>
  )
}

function FkStatCard({ stats }: { stats: FkStats }) {
  const maxV = Math.max(...stats.topValues.map(v => v.count), 1)
  return (
    <div className="space-y-1.5 text-gv-text-dim">
      <div className="flex justify-between"><span>数量</span><span className="font-mono text-gv-text">{stats.count}</span></div>
      <div className="flex justify-between"><span>去重后</span><span className="font-mono text-gv-text">{stats.distinctCount}</span></div>
      <div className="flex justify-between"><span>空值</span><span className="font-mono text-gv-text">{stats.nullCount}</span></div>
      {stats.topValues.length > 0 && (
        <div className="mt-2">
          <p className="text-gv-text-muted mb-1">高频值</p>
          {stats.topValues.map((v, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="font-mono text-xs truncate w-16">{v.value}</span>
              <span className="font-mono text-gv-text-muted">{v.count}</span>
              {tinyBar(v.count, maxV)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PhoneStatCard({ stats }: { stats: PhoneStats }) {
  return (
    <div className="space-y-1.5 text-gv-text-dim">
      <div className="flex justify-between"><span>数量</span><span className="font-mono text-gv-text">{stats.count}</span></div>
      <div className="flex justify-between"><span>去重后</span><span className="font-mono text-gv-text">{stats.distinctCount}</span></div>
      <div className="flex justify-between"><span>空值</span><span className="font-mono text-gv-text">{stats.nullCount}</span></div>
    </div>
  )
}

function CityStatCard({ stats }: { stats: CityStats }) {
  const maxP = Math.max(...stats.byProvince.map(p => p.count), 1)
  return (
    <div className="space-y-1.5 text-gv-text-dim">
      <div className="flex justify-between"><span>数量</span><span className="font-mono text-gv-text">{stats.count}</span></div>
      <div className="flex justify-between"><span>去重后</span><span className="font-mono text-gv-text">{stats.distinctCount}</span></div>
      <div className="mt-2">
        <p className="text-gv-text-muted mb-1">按省分布</p>
        {stats.byProvince.map((p, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="w-16 truncate text-xs">{p.province}</span>
            <span className="font-mono text-gv-text-muted text-xs">{p.count}</span>
            {tinyBar(p.count, maxP)}
          </div>
        ))}
      </div>
    </div>
  )
}

function renderCellValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined) return <span className="text-gv-text-muted italic">null</span>
  if (typeof val === 'boolean') return <span className={val ? 'text-gv-green-dark font-medium' : 'text-gv-pink-dark'}>{String(val)}</span>
  if (typeof val === 'number') return <span className="font-mono text-gv-pink">{val}</span>
  return <span>{String(val)}</span>
}
