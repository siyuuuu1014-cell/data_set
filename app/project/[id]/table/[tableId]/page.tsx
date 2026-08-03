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
import { previewGenerationExpression } from '@/services/expression-preview'
import styles from '../table-workflow.module.css'

let _colIdCounter = Date.now()
function genColId(): string { return 'col_' + (_colIdCounter++).toString(36) }

const COLUMN_TYPES: { value: ColumnType; key: string }[] = [
  { value: 'text', key: 'coltype.text' },
  { value: 'number', key: 'coltype.number' },
  { value: 'boolean', key: 'coltype.boolean' },
  { value: 'date', key: 'coltype.date' },
  { value: 'id', key: 'coltype.id' },
  { value: 'phone', key: 'coltype.phone' },
  { value: 'city', key: 'coltype.city' },
  { value: 'foreign_key', key: 'coltype.foreign_key' },
  { value: 'foreign_key_array', key: 'coltype.foreign_key_array' },
]

const TYPE_KEY: Record<ColumnType, string> = {
  text: 'coltype.text_short', number: 'coltype.number_short', boolean: 'coltype.boolean_short', date: 'coltype.date_short',
  id: 'coltype.id_short', phone: 'coltype.phone_short', city: 'coltype.city_short', foreign_key: 'coltype.foreign_key',
  foreign_key_array: 'coltype.foreign_key_array',
}

const PHONE_COUNTRIES: { value: PhoneCountry; key: string }[] = [
  { value: 'CN', key: 'country.CN' },
  { value: 'US', key: 'country.US' },
  { value: 'JP', key: 'country.JP' },
  { value: 'KR', key: 'country.KR' },
  { value: 'GB', key: 'country.GB' },
  { value: 'DE', key: 'country.DE' },
  { value: 'FR', key: 'country.FR' },
  { value: 'IN', key: 'country.IN' },
  { value: 'BR', key: 'country.BR' },
  { value: 'AU', key: 'country.AU' },
]

const ID_FORMATS: { value: IdFormat; key: string }[] = [
  { value: 'uuid4', key: 'idfmt.uuid4' },
  { value: 'uuid7', key: 'idfmt.uuid7' },
  { value: 'snowflake', key: 'idfmt.snowflake' },
  { value: 'auto_increment', key: 'idfmt.auto_increment' },
  { value: 'cuid2', key: 'idfmt.cuid2' },
  { value: 'objectid', key: 'idfmt.objectid' },
  { value: 'nanoid', key: 'idfmt.nanoid' },
  { value: 'ulid', key: 'idfmt.ulid' },
]

const DATE_FORMATS: { value: DateFormat; key: string }[] = [
  { value: 'date', key: 'datefmt.date' },
  { value: 'datetime', key: 'datefmt.datetime' },
  { value: 'iso', key: 'datefmt.iso' },
  { value: 'date_slash', key: 'datefmt.date_slash' },
  { value: 'date_us', key: 'datefmt.date_us' },
  { value: 'date_eu', key: 'datefmt.date_eu' },
  { value: 'time', key: 'datefmt.time' },
  { value: 'unix_s', key: 'datefmt.unix_s' },
  { value: 'unix_ms', key: 'datefmt.unix_ms' },
]

const PRESET_DATE_RANGES: { key: string; minDays: number; maxDays: number }[] = [
  { key: 'daterange.7d', minDays: 0, maxDays: 7 },
  { key: 'daterange.15d', minDays: 0, maxDays: 15 },
  { key: 'daterange.30d', minDays: 0, maxDays: 30 },
  { key: 'daterange.90d', minDays: 0, maxDays: 90 },
  { key: 'daterange.180d', minDays: 0, maxDays: 180 },
  { key: 'daterange.1y', minDays: 0, maxDays: 365 },
  { key: 'daterange.3y', minDays: 0, maxDays: 1095 },
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
      URL.revokeObjectURL(img.src)
      let { width, height } = img
      if (width <= maxPx && height <= maxPx) {
        // Already small enough, just read as data URL
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Failed to read image'))
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
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
    img.src = URL.createObjectURL(file)
  })
}

function ensureDateDistribution(col: ColumnDef): DateRange[] {
  if (!col.dateDistribution || col.dateDistribution.length === 0) {
    return PRESET_DATE_RANGES.map(r => ({ label: r.key, minDays: r.minDays, maxDays: r.maxDays, ratio: 0 }))
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
  const [rowsLoading, setRowsLoading] = useState((table?.rowCount ?? 0) !== 0 && (table?.rows.length ?? 0) === 0)
  const [pageSize, setPageSize] = useState(50)
  const [currentPage, setCurrentPage] = useState(1)
  const [workspaceMode, setWorkspaceMode] = useState<'data' | 'statistics'>('data')
  const [generatedColumns, setGeneratedColumns] = useState<Set<string>>(new Set())

  const [llmConfigured, setLlmConfigured] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [imageUploading, setImageUploading] = useState(false)
  const [importingNuwa, setImportingNuwa] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nuwaFileRef = useRef<HTMLInputElement>(null)
  const dataFetchSeqRef = useRef(0)
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
    if (!table) return
    let rows = table.rows
    try {
      const res = await fetch(`/api/data?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(table.name)}`)
      if (res.ok) {
        const data = await res.json() as { rows: Record<string, unknown>[] }
        rows = data.rows
      }
    } catch {}
    const nuwaData = { version: 1, tables: [{ ...table, rows }] }
    const blob = new Blob([JSON.stringify(nuwaData, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${table.id}.nuwa`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }

  const handleExportCsv = async () => {
    if (!table) return
    let rows = table.rows
    try {
      const res = await fetch(`/api/data?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(table.name)}`)
      if (res.ok) {
        const data = await res.json() as { rows: Record<string, unknown>[] }
        rows = data.rows
      }
    } catch {}
    const tableWithRows = { ...table, rows }
    downloadFile(exportCsv(tableWithRows), `${table.name}.csv`, 'text/csv;charset=utf-8')
  }

  const handleImportNuwa = async (file: File) => {
    setGenError('')
    setImportingNuwa(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const tables = data.tables || (data.table ? [data.table] : null)
      if (!tables) throw new Error('Invalid .nuwa file format')
      let imported = 0
      for (const nuwaTable of tables) {
        if (nuwaTable.rows && nuwaTable.rows.length > 0) {
          const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: id,
              tableName: table?.name || nuwaTable.name,
              columns: table?.columns || [],
              rows: nuwaTable.rows,
            }),
          })
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}))
            throw new Error(errData.error || `HTTP ${res.status}`)
          }
          imported += nuwaTable.rows.length
        }
      }
      // Reload displayed rows for current table from API to get consistent data
      if (table) {
        try {
          const reloadRes = await fetch(`/api/data?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(table.name)}`)
          if (reloadRes.ok) {
            const { rows: freshRows } = await reloadRes.json() as { rows: Record<string, unknown>[] }
            if (freshRows && freshRows.length > 0) {
              setDisplayedRows(freshRows)
              setCurrentPage(1)
              setTableRows(id, table.id, freshRows)
              setGeneratedColumns(new Set(table.columns.map(c => c.id)))
            }
          }
        } catch {}
      }
      if (imported > 0) {
        const msg = t('table.import_success').replace('{0}', String(imported))
        setGenError(msg)
      } else {
        setGenError(t('table.import_no_data'))
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : t('table.import_fail'))
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
    const seq = ++dataFetchSeqRef.current
    const url = `/api/data?projectId=${id}&tableName=${encodeURIComponent(table.name)}`
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (seq !== dataFetchSeqRef.current) return // stale response
        if (data.rows?.length > 0) {
          setDisplayedRows(data.rows)
          setTableRows(id, table.id, data.rows)
          setCurrentPage(1)
          // Auto-extract column names from first row if none configured
          if ((table.columns || []).length === 0) {
            const cols = Object.keys(data.rows[0]).map(name => ({
              id: name + '_col',
              name,
              type: 'text' as const,
              llmPrompt: '',
              generationCode: '',
            }))
            updateTable(id, table.id, { columns: cols, rowCount: data.rows.length })
          } else if (table.rowCount === -1) {
            updateTable(id, table.id, { rowCount: data.rows.length })
          }
        }
        setRowsLoading(false)
      })
      .catch(() => { if (seq === dataFetchSeqRef.current) setRowsLoading(false) })
  }, [id, table?.name])  // eslint-disable-line react-hooks/exhaustive-deps

  const [editMode, setEditMode] = useState(false)
  const [editName, setEditName] = useState(table?.name || '')
  const [editColumns, setEditColumns] = useState<ColumnDef[]>(table?.columns || [])
  const [selectedEditColumnId, setSelectedEditColumnId] = useState(table?.columns[0]?.id || '')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [hoveredGuideIndex, setHoveredGuideIndex] = useState<number | null>(null)

  if (!project || !table) {
    return (
      <main className={styles.editorState}>
        <div>
          <h1>{t('table.not_found')}</h1>
          <p>{t('state.not_found_desc')}</p>
          <Link href={`/project/${id}`}>
            {t('table.back_to_project')}
          </Link>
        </div>
      </main>
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

      dataFetchSeqRef.current++ // invalidate any in-flight initial fetch
      setTableRows(id, table.id, blankRows)
      setDisplayedRows(blankRows)
      setCurrentPage(1)
      setGeneratedColumns(new Set())
    } catch (err) {
      setGenError(err instanceof Error ? err.message : t('table.gen_fail_short'))
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
      throw new Error(`${t('table.save_data_fail')}: ${data.error || res.status}`)
    }
  }

  const handleGenerateColumn = async (col: ColumnDef) => {
    setGenError('')
    if (col.type === 'text' && !col.nullable && !col.llmPrompt?.trim()) {
      setGenError(`${t('table.prompt_empty_warn', col.name)}`)
      return
    }
    setColumnGenerating(col.id)
    try {
      // Build refData for all columns that reference another table
      const foreignTables = new Set<string>()
      for (const c of table.columns) {
        if (c.foreignTable) foreignTables.add(c.foreignTable)
      }
      const refData: Record<string, Record<string, unknown>[]> = {}
      const loadedFrom = new Set<string>() // avoid duplicate Parquet fetches
      for (const ft of foreignTables) {
        const parentTable = allTables.find(t => t.id === ft || t.name === ft)
        if (!parentTable) continue
        if (parentTable.rows.length > 0) {
          refData[parentTable.id] = parentTable.rows
          refData[parentTable.name] = parentTable.rows
          loadedFrom.add(parentTable.name)
        } else if (!loadedFrom.has(parentTable.name)) {
          loadedFrom.add(parentTable.name)
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
      const values = await generateColumn(col, rowCount, refData, columnResults, table.columns)

      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < rowCount; i++) {
        const existing = displayedRows[i] || {}
        rows.push({ ...existing, [col.name]: values[i] ?? null })
      }

      setDisplayedRows(rows)
      setCurrentPage(1)
      setTableRows(id, table.id, rows)
      await saveToParquet(rows)
      setGeneratedColumns(prev => new Set(prev).add(col.id))
    } catch (err) {
      setGenError(err instanceof Error ? err.message : t('table.gen_fail_short'))
    } finally {
      setColumnGenerating(null)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setGenError(t('table.image_too_large'))
      return
    }
    setImageUploading(true)
    setGenError('')
    try {
      const base64 = await resizeImage(file)
      const { callLlmVision } = await import('@/services/llm')
      const raw = await callLlmVision(VISION_SYSTEM_PROMPT, 'Identify the table column structure in the image', [base64])
      const parsed = extractJsonArray(raw)
      if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
        setGenError(t('table.image_no_columns'))
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
      setSelectedEditColumnId(newCols[0]?.id || '')
      updateTable(id, table.id, { columns: newCols })
      setEditMode(true)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setGenError(err instanceof Error ? err.message : t('table.image_fail'))
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
    const editableColumns = JSON.parse(JSON.stringify(table.columns)) as ColumnDef[]
    setEditName(table.name)
    setEditColumns(editableColumns)
    setSelectedEditColumnId(editableColumns[0]?.id || '')
    setEditMode(true)
  }

  const saveEdit = async () => {
    const invalid = editColumns.find(c => !c.name.trim())
    if (invalid) {
      setGenError(t('table.col_name_required'))
      return
    }
    const newName = editName.trim()
    if (!newName) {
      setGenError(t('table.table_name_required'))
      return
    }
    if (newName !== table.name && tables.some(t => t.id !== table.id && t.name === newName)) {
      setGenError(t('table.name_exists'))
      return
    }
    const renamed = newName !== table.name
    const oldName = table.name

    // Detect column-set changes against persisted Parquet data: renaming,
    // deleting, or reordering columns does not rewrite the stored schema, so
    // exported rows would silently mismatch. Warn and keep the editor open.
    const hasGeneratedData = (table.rowCount ?? 0) > 0 || (table.rows?.length ?? 0) > 0
    if (hasGeneratedData) {
      const oldKeys = table.columns.map(c => c.name)
      const newKeys = editColumns.map(c => c.name)
      const keysChanged = oldKeys.length !== newKeys.length
        || oldKeys.some((name, index) => name !== newKeys[index])
      if (keysChanged) {
        setGenError(t('table.schema_change_warning'))
        return
      }
    }

    updateTable(id, table.id, { name: newName, columns: editColumns })
    if (renamed) {
      try {
        const res = await fetch('/api/data', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: id, fromTable: oldName, toTable: newName }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          const msg = (body && typeof body.error === 'string' && body.error) || t('table.rename_failed')
          setGenError(msg)
          updateTable(id, table.id, { name: oldName, columns: editColumns })
          return
        }
      } catch {
        setGenError(t('table.rename_failed'))
        updateTable(id, table.id, { name: oldName, columns: editColumns })
        return
      }
    }
    setEditMode(false)
    setGenError('')
    // Schema changed — reset generate button state
    setGeneratedColumns(new Set())
  }

  const updateEditCol = (colId: string, updates: Partial<ColumnDef>) => {
    setEditColumns(prev => prev.map(c => (c.id === colId ? { ...c, ...updates } : c)))
  }

  const addEditColumn = (afterIndex?: number) => {
    const column = emptyColumn()
    setEditColumns(prev => {
      if (afterIndex !== undefined && afterIndex >= 0 && afterIndex < prev.length) {
        return [...prev.slice(0, afterIndex + 1), column, ...prev.slice(afterIndex + 1)]
      }
      return [...prev, column]
    })
    setSelectedEditColumnId(column.id)
  }

  const removeEditColumn = (colId: string) => {
    if (editColumns.length <= 1) return
    setEditColumns(prev => {
      const removedIndex = prev.findIndex(column => column.id === colId)
      const next = prev.filter(column => column.id !== colId)
      if (selectedEditColumnId === colId) {
        setSelectedEditColumnId(next[Math.min(Math.max(removedIndex, 0), next.length - 1)]?.id || '')
      }
      return next
    })
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
    <main className={styles.editorPage}>
      {/* Header */}
      <div className={styles.editorHeader}>
        <div className="flex items-center gap-3">
          <Link href={`/project/${id}`} className="text-gv-text-dim hover:text-gv-pink transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h2 className="text-lg font-semibold text-gv-text">{table.name}</h2>
        </div>
        <div className={styles.editorActions}>
          <input ref={nuwaFileRef} type="file" accept=".nuwa" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportNuwa(f); if (nuwaFileRef.current) nuwaFileRef.current.value = '' }} />
          <button onClick={() => nuwaFileRef.current?.click()} disabled={importingNuwa}
            className="btn-outline rounded-lg px-3 py-1.5 text-sm inline-flex items-center gap-1 disabled:opacity-50">
            {importingNuwa ? '...' : t('table.import_nuwa')}
          </button>
          <div className="relative">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowExportMenu(!showExportMenu)} disabled={displayedRows.length === 0}
              className="btn-outline rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {t('table.export_menu')}
            </button>
            {showExportMenu && (
              <div ref={exportMenuRef} className={`absolute right-0 top-full mt-1 w-44 rounded-lg border border-ui-border bg-ui-surface shadow-lg z-50 overflow-hidden ${styles.exportMenu}`}>
                <button onClick={() => { downloadFile(exportJson(table), `${table.name}.json`, 'application/json'); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-ui-icon-accent-soft transition-colors">JSON</button>
                <button onClick={() => { handleExportCsv(); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-ui-icon-accent-soft transition-colors">CSV</button>
                <button onClick={() => { downloadFile(exportExcel(table), `${table.name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-ui-icon-accent-soft transition-colors">Excel (XLSX)</button>
                <button onClick={() => { downloadFile(exportXml(table), `${table.name}.xml`, 'application/xml'); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-ui-icon-accent-soft transition-colors">XML</button>
                <button onClick={() => { downloadFile(exportSql(table), `${table.name}.sql`, 'text/plain'); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-ui-icon-accent-soft transition-colors">SQL INSERT</button>
                <button onClick={() => { const a = document.createElement('a'); a.href = `/api/data/download?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(table.name)}`; a.download = `${table.name}.parquet`; document.body.appendChild(a); a.click(); document.body.removeChild(a); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-ui-icon-accent-soft transition-colors">Parquet</button>
                <button onClick={() => { handleExportNuwa(); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gv-text hover:bg-ui-icon-accent-soft transition-colors border-t border-ui-border">{t('table.export_nuwa')}</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className={`${styles.editorGrid} ${editMode ? styles.editorGridEditing : ''}`}>
        <nav className={`${styles.workspaceModes} ${styles.workspaceModeBar}`} aria-label={t('table.workspace_modes')}>
          <button type="button" aria-current={!editMode && workspaceMode === 'data' ? 'page' : undefined} onClick={() => { setEditMode(false); setWorkspaceMode('data') }}>
            {t('table.data_view')}
          </button>
          <button type="button" aria-current={!editMode && workspaceMode === 'statistics' ? 'page' : undefined} disabled={displayedRows.length === 0} onClick={() => { setEditMode(false); setWorkspaceMode('statistics') }}>
            {t('stats.title')}
          </button>
          <button type="button" aria-current={editMode ? 'page' : undefined} onClick={startEdit}>
            {t('table.edit_schema')}
          </button>
          <span>{table.columns.length} {t('table.columns_unit')} / {displayedRows.length > 0 ? displayedRows.length : (table.rowCount ?? 0)} {t('table.rows')}</span>
        </nav>
        {/* LEFT ~30% — Column schema + edit */}
        <div className={`${styles.schemaPanel} ${editMode ? styles.schemaPanelEditing : ''}`}>

      {!editMode && (
        <nav
          className={styles.tableWorkbenchGuide}
          aria-label={t('table.workbench_guide')}
          style={{ '--guide-index': hoveredGuideIndex ?? (workspaceMode === 'statistics' ? 2 : 0) } as React.CSSProperties}
          onPointerLeave={() => setHoveredGuideIndex(null)}
        >
          <div className={styles.tableWorkbenchGuideHeader}>
            <strong>{t('table.workbench_guide')}</strong>
          </div>
          <div className={styles.tableWorkbenchGuideOptions}>
            <span className={styles.tableWorkbenchGuideIndicator} aria-hidden="true" />
            <button type="button" aria-current={workspaceMode === 'data' ? 'page' : undefined} onPointerEnter={() => setHoveredGuideIndex(0)} onClick={() => setWorkspaceMode('data')}>
              <span aria-hidden="true"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 7h16M4 12h16M4 17h10" /></svg></span>
              <span><strong>{t('table.data_view')}</strong><small>{t('table.data_view_help')}</small></span>
            </button>
            <button type="button" onPointerEnter={() => setHoveredGuideIndex(1)} onClick={startEdit}>
              <span aria-hidden="true"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 6h16M4 12h16M4 18h10M8 4v4m8 2v4m-6 2v4" /></svg></span>
              <span><strong>{t('table.edit_schema')}</strong><small>{t('table.schema_view_help')}</small></span>
            </button>
            <button type="button" aria-current={workspaceMode === 'statistics' ? 'page' : undefined} disabled={displayedRows.length === 0} onPointerEnter={() => setHoveredGuideIndex(2)} onClick={() => setWorkspaceMode('statistics')}>
              <span aria-hidden="true"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 19V9m7 10V5m7 14v-7" /></svg></span>
              <span><strong>{t('stats.title')}</strong><small>{t('table.stats_view_help')}</small></span>
            </button>
          </div>
        </nav>
      )}

      {editMode && (
        <aside className={styles.editBaseSidebar} aria-label={t('table.workbench_guide')}>
          <nav
            className={styles.tableWorkbenchGuide}
            aria-label={t('table.workbench_guide')}
            style={{ '--guide-index': hoveredGuideIndex ?? 1 } as React.CSSProperties}
            onPointerLeave={() => setHoveredGuideIndex(null)}
          >
            <div className={styles.tableWorkbenchGuideHeader}>
              <strong>{t('table.workbench_guide')}</strong>
            </div>
            <div className={styles.tableWorkbenchGuideOptions}>
              <span className={styles.tableWorkbenchGuideIndicator} aria-hidden="true" />
              <button type="button" onPointerEnter={() => setHoveredGuideIndex(0)} onClick={() => { setEditMode(false); setWorkspaceMode('data') }}>
                <span aria-hidden="true"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 7h16M4 12h16M4 17h10" /></svg></span>
                <span><strong>{t('table.data_view')}</strong><small>{t('table.data_view_help')}</small></span>
              </button>
              <button type="button" aria-current="page" onPointerEnter={() => setHoveredGuideIndex(1)}>
                <span aria-hidden="true"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 6h16M4 12h16M4 18h10M8 4v4m8 2v4m-6 2v4" /></svg></span>
                <span><strong>{t('table.edit_schema')}</strong><small>{t('table.schema_view_help')}</small></span>
              </button>
              <button type="button" disabled={displayedRows.length === 0} onPointerEnter={() => setHoveredGuideIndex(2)} onClick={() => { setEditMode(false); setWorkspaceMode('statistics') }}>
                <span aria-hidden="true"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 19V9m7 10V5m7 14v-7" /></svg></span>
                <span><strong>{t('stats.title')}</strong><small>{t('table.stats_view_help')}</small></span>
              </button>
            </div>
          </nav>
          <section className={styles.editBaseColumns}>
            <div className={styles.editBaseColumnsHeader}>
              <strong>{t('table.columns')}</strong>
              <span>{generatedColumns.size}/{table.columns.length}</span>
            </div>
            <div className={styles.editBaseColumnList}>
              {table.columns.map(column => (
                <div key={column.id}>
                  <span className={styles.editBaseColumnCopy}>
                    <strong>{column.name}</strong>
                    <small>{t(TYPE_KEY[column.type])}</small>
                  </span>
                  {generatedColumns.has(column.id) ? (
                    <span className={styles.generatedMark} aria-hidden="true">✓</span>
                  ) : (
                    <button type="button" onClick={() => handleGenerateColumn(column)} disabled={columnGenerating != null}>
                      {columnGenerating === column.id ? '…' : t('table.generate')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </aside>
      )}

      {editMode ? (
        <div className={styles.schemaWorkbench}>
          <aside className={styles.schemaDirectory} aria-label={t('table.edit_field_directory')}>
            <div className={styles.schemaDirectoryHeader}>
              <div>
                <h3>{t('table.edit_schema')}</h3>
                <p>{t('table.edit_schema_help')}</p>
              </div>
              <span>{editColumns.length}</span>
            </div>
            <nav className={styles.editFieldList}>
              {editColumns.map((column, index) => (
                <div
                  key={column.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={event => handleDragOver(event, index)}
                  onDragEnd={handleDragEnd}
                  className={dragIndex === index ? styles.editFieldDragging : undefined}
                >
                  <span className={styles.editDragHandle} title={t('table.drag_hint')} aria-hidden="true">
                    <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                    </svg>
                  </span>
                  <button
                    type="button"
                    aria-current={selectedEditColumnId === column.id ? 'page' : undefined}
                    onClick={() => setSelectedEditColumnId(column.id)}
                  >
                    <strong>{column.name || t('table.unnamed_field')}</strong>
                    <small>{index + 1} · {t(TYPE_KEY[column.type])}</small>
                  </button>
                </div>
              ))}
            </nav>
            <button type="button" className={styles.addFieldButton} onClick={() => addEditColumn()}>
              <span aria-hidden="true">+</span>{t('table.add_col')}
            </button>
          </aside>

          <section className={styles.schemaEditorCanvas}>
            <header>
              <div>
                <span>{t('table.editing_field')}</span>
                <h3>{editColumns.find(column => column.id === selectedEditColumnId)?.name || t('table.unnamed_field')}</h3>
              </div>
              <button type="button" onClick={() => setEditMode(false)} aria-label={t('table.discard_changes')}>
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </header>
            <div className={styles.tableNameEditor}>
              <label htmlFor="edit-table-name">{t('table.name')}</label>
              <input id="edit-table-name" type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="input-field" />
            </div>
            {editColumns.filter(column => column.id === selectedEditColumnId).map(col => {
              const i = editColumns.findIndex(column => column.id === col.id)
              return (
              <div key={col.id} className={styles.fieldEditor}>
                <div className={styles.fieldEditorHeading}>
                  <span>{t('table.field_basics')}</span>
                  <div className={styles.fieldIdentityControls}>
                    <input type="text" value={col.name} onChange={(e) => updateEditCol(col.id, { name: e.target.value })}
                      placeholder={t('table.col_name')}
                      className="input-field" />
                    <select value={col.type} onChange={(e) => updateEditCol(col.id, { type: e.target.value as ColumnType })}
                      className={styles.fieldTypeSelect}>
                      {COLUMN_TYPES.map(ct => (<option key={ct.value} value={ct.value}>{t(ct.key)}</option>))}
                    </select>
                  </div>
                  {editColumns.length > 1 && (
                    <button type="button" onClick={() => removeEditColumn(col.id)} className={styles.removeFieldButton}>
                      {t('table.remove_field')}
                    </button>
                  )}
                </div>
                <section className={styles.fieldRuleSection}>
                  <div className={styles.fieldRuleHeading}>
                    <strong>{t('table.field_generation')}</strong>
                    <small>{t('table.field_generation_help')}</small>
                  </div>
                  <div className={styles.fieldRuleControls}>
                {col.type === 'text' && (
                  <textarea value={col.llmPrompt || ''} onChange={(e) => updateEditCol(col.id, { llmPrompt: e.target.value })}
                    placeholder={t('table.text_prompt_placeholder')}
                    rows={2}
                    className="input-field w-full py-2 text-sm" />
                )}
                {col.type === 'number' && (
                  <div className="space-y-2">
                    <select value={col.foreignTable || ''} onChange={(e) => updateEditCol(col.id, { foreignTable: e.target.value || undefined })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">{t('table.ref_table_number')}</option>
                      {allTables.filter(t => t.id !== table.id).map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    {col.foreignTable && (
                      <div className="flex gap-2">
                        <select value={col.localMatchColumn || ''} onChange={(e) => updateEditCol(col.id, { localMatchColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-sm focus:outline-none focus:border-gv-pink">
                          <option value="">本表关联列（自动）</option>
                          {table.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                        <select value={col.foreignColumn || ''} onChange={(e) => updateEditCol(col.id, { foreignColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-sm focus:outline-none focus:border-gv-pink">
                          <option value="">外表关联列（默认 id）</option>
                          {allTables.find(t => t.id === col.foreignTable)?.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <textarea value={col.llmPrompt || ''} onChange={(e) => updateEditCol(col.id, { llmPrompt: e.target.value })}
                        placeholder={t('table.number_prompt_placeholder')}
                        rows={1}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                        className="flex-1 input-field py-1.5 text-sm font-sans resize-none overflow-x-auto whitespace-nowrap prompt-input" />
                      <button type="button"
                        onClick={async () => {
                          if (!col.llmPrompt?.trim()) return
                          updateEditCol(col.id, { generationCode: '...' })
                          const { llmGenerateCode } = await import('@/services/data-gen')
                          const result = await llmGenerateCode(col.llmPrompt!.trim(), 'number')
                          updateEditCol(col.id, { generationCode: result.code || `// ${result.error || 'Error'}` })
                        }}
                        disabled={!col.llmPrompt?.trim()}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gv-pink/30 text-gv-pink hover:bg-gv-pink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                        {t('table.ai_gen_code')}
                      </button>
                    </div>
                    <textarea value={col.generationCode || ''} onChange={(e) => updateEditCol(col.id, { generationCode: e.target.value })}
                      placeholder={t('table.code_placeholder')}
                      rows={3}
                      className="input-field w-full py-2 text-sm font-mono" />
                    {col.generationCode && col.generationCode !== '...' && (
                      <button type="button"
                        onClick={() => {
                          try {
                            const results = previewGenerationExpression(col.generationCode!)
                            alert(`Test results (5):\n${results.map((v, i) => `  [${i}] ${v}`).join('\n')}`)
                          } catch (err) {
                            alert(`Code error: ${err instanceof Error ? err.message : String(err)}`)
                          }
                        }}
                        className="text-xs text-gv-pink hover:text-gv-pink-dark transition-colors">
                        {t('table.test_code')}
                      </button>
                    )}
                  </div>
                )}
                {(col.type === 'foreign_key' || col.type === 'foreign_key_array') && (
                  <div className="space-y-2">
                    <select value={col.foreignTable || ''} onChange={(e) => updateEditCol(col.id, { foreignTable: e.target.value })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">{t('table.select_ref_table')}</option>
                      {allTables.filter(t => t.id !== table.id).map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    <select value={col.foreignColumn || ''} onChange={(e) => updateEditCol(col.id, { foreignColumn: e.target.value })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">{t('table.auto_match_col')}</option>
                      {allTables.find(t => t.id === col.foreignTable)?.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                    </select>
                  </div>
                )}
                {col.type === 'date' && (
                  <div className="space-y-3">
                    <select value={col.foreignTable || ''} onChange={(e) => updateEditCol(col.id, { foreignTable: e.target.value || undefined })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">{t('table.ref_table_date')}</option>
                      {allTables.filter(t => t.id !== table.id).map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    {col.foreignTable && (
                      <div className="flex gap-2">
                        <select value={col.localMatchColumn || ''} onChange={(e) => updateEditCol(col.id, { localMatchColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-sm focus:outline-none focus:border-gv-pink">
                          <option value="">本表关联列（自动）</option>
                          {table.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                        <select value={col.foreignColumn || ''} onChange={(e) => updateEditCol(col.id, { foreignColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-sm focus:outline-none focus:border-gv-pink">
                          <option value="">外表关联列（默认 id）</option>
                          {allTables.find(t => t.id === col.foreignTable)?.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                      </div>
                    )}
                    {col.foreignTable && (
                      <select value={col.parentDateColumn || ''} onChange={(e) => updateEditCol(col.id, { parentDateColumn: e.target.value || undefined })}
                        className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                        <option value="">选择外表日期字段（手动写公式则留空）</option>
                        {allTables.find(t => t.id === col.foreignTable)?.columns.filter(c => c.type === 'date').map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                      </select>
                    )}
                    <select value={col.dateFormat || 'date'} onChange={(e) => updateEditCol(col.id, { dateFormat: e.target.value as DateFormat })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      {DATE_FORMATS.map(f => (<option key={f.value} value={f.value}>{t(f.key)}</option>))}
                    </select>
                    <div>
                      <p className="text-xs text-gv-text-dim mb-1">{t('table.date_distribution')}</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {ensureDateDistribution(col).map((range, ri) => (
                          <div key={ri} className="flex items-center gap-1.5">
                            <span className="text-xs text-gv-text-dim w-20 flex-shrink-0">{t(range.label)}</span>
                            <input
                              type="number" min={0} max={100}
                              value={range.ratio}
                              onChange={(e) => {
                                const dist = [...ensureDateDistribution(col)]
                                dist[ri] = { ...dist[ri], ratio: Number(e.target.value) || 0 }
                                updateEditCol(col.id, { dateDistribution: dist })
                              }}
                              className="flex-1 input-field py-1 text-sm min-w-0"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <textarea value={col.llmPrompt || ''} onChange={(e) => updateEditCol(col.id, { llmPrompt: e.target.value })}
                        placeholder={t('table.date_prompt_placeholder')}
                        rows={1}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                        className="flex-1 input-field py-1.5 text-sm font-sans resize-none overflow-x-auto whitespace-nowrap prompt-input" />
                      <button type="button"
                        onClick={async () => {
                          if (!col.llmPrompt?.trim()) return
                          updateEditCol(col.id, { generationCode: '...' })
                          const { llmGenerateCode } = await import('@/services/data-gen')
                          const result = await llmGenerateCode(col.llmPrompt!.trim(), 'date', { dateFormat: col.dateFormat, dateDistribution: col.dateDistribution })
                          updateEditCol(col.id, { generationCode: result.code || `// ${result.error || 'Error'}` })
                        }}
                        disabled={!col.llmPrompt?.trim()}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gv-pink/30 text-gv-pink hover:bg-gv-pink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                        {t('table.ai_gen_code')}
                      </button>
                    </div>
                    <input type="text" value={col.generationCode || ''} onChange={(e) => updateEditCol(col.id, { generationCode: e.target.value })}
                      placeholder={t('table.code_placeholder_short')}
                      className="input-field w-full py-2 text-sm font-mono" />
                    {col.generationCode && col.generationCode !== '...' && (
                      <button type="button"
                        onClick={() => {
                          try {
                            const results = previewGenerationExpression(col.generationCode!)
                            alert(`Test results (5):\n${results.map((v, i) => `  [${i}] ${v}`).join('\n')}`)
                          } catch (err) {
                            alert(`Code error: ${err instanceof Error ? err.message : String(err)}`)
                          }
                        }}
                        className="text-xs text-gv-pink hover:text-gv-pink-dark transition-colors">
                        {t('table.test_code')}
                      </button>
                    )}
                  </div>
                )}
                {col.type === 'boolean' && (
                  <div className="space-y-2">
                    <select value={col.foreignTable || ''} onChange={(e) => updateEditCol(col.id, { foreignTable: e.target.value || undefined })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">{t('table.ref_table_boolean')}</option>
                      {allTables.filter(t => t.id !== table.id).map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    {col.foreignTable && (
                      <div className="flex gap-2">
                        <select value={col.localMatchColumn || ''} onChange={(e) => updateEditCol(col.id, { localMatchColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-sm focus:outline-none focus:border-gv-pink">
                          <option value="">本表关联列（自动）</option>
                          {table.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                        <select value={col.foreignColumn || ''} onChange={(e) => updateEditCol(col.id, { foreignColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-sm focus:outline-none focus:border-gv-pink">
                          <option value="">外表关联列（默认 id）</option>
                          {allTables.find(t => t.id === col.foreignTable)?.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <textarea value={col.llmPrompt || ''} onChange={(e) => updateEditCol(col.id, { llmPrompt: e.target.value })}
                        placeholder={t('table.bool_prompt_placeholder')}
                        rows={1}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                        className="flex-1 input-field py-1.5 text-sm font-sans resize-none overflow-x-auto whitespace-nowrap prompt-input" />
                      <button type="button"
                        onClick={async () => {
                          if (!col.llmPrompt?.trim()) return
                          updateEditCol(col.id, { generationCode: '...' })
                          const { llmGenerateCode } = await import('@/services/data-gen')
                          const result = await llmGenerateCode(col.llmPrompt!.trim(), 'boolean')
                          updateEditCol(col.id, { generationCode: result.code || `// ${result.error || 'Error'}` })
                        }}
                        disabled={!col.llmPrompt?.trim()}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gv-pink/30 text-gv-pink hover:bg-gv-pink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                        {t('table.ai_gen_code')}
                      </button>
                    </div>
                    <input type="text" value={col.generationCode || ''} onChange={(e) => updateEditCol(col.id, { generationCode: e.target.value })}
                      placeholder={t('table.bool_placeholder')}
                      className="input-field w-full py-2 text-sm font-mono" />
                    {col.generationCode && col.generationCode !== '...' && (
                      <button type="button"
                        onClick={() => {
                          try {
                            const results = previewGenerationExpression(col.generationCode!, 'boolean')
                            alert(`Test results (5):\n${results.map((v, i) => `  [${i}] ${v ? '1 (true)' : '0 (false)'}`).join('\n')}`)
                          } catch (err) {
                            alert(`Code error: ${err instanceof Error ? err.message : String(err)}`)
                          }
                        }}
                        className="text-xs text-gv-pink hover:text-gv-pink-dark transition-colors">
                        {t('table.test_code')}
                      </button>
                    )}
                    <div className="flex items-center gap-2 pt-1 pl-1">
                      <span className="text-xs text-gv-text-muted w-16">{t('table.bool_true_ratio')}</span>
                      <input
                        type="range"
                        min={0} max={100}
                        value={col.boolTrueRatio ?? 50}
                        onMouseDown={(e) => e.stopPropagation()}
                        onDragStart={(e) => e.stopPropagation()}
                        onChange={(e) => updateEditCol(col.id, { boolTrueRatio: Number(e.target.value) })}
                        className="flex-1 accent-gv-pink h-1"
                      />
                      <span className="text-xs font-mono text-gv-text w-9 text-right">{col.boolTrueRatio ?? 50}%</span>
                    </div>
                  </div>
                )}
                {col.type === 'id' && (
                  <select value={col.idFormat || 'uuid4'} onChange={(e) => updateEditCol(col.id, { idFormat: e.target.value as IdFormat })}
                    className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                    {ID_FORMATS.map(f => (<option key={f.value} value={f.value}>{t(f.key)}</option>))}
                  </select>
                )}
                {col.type === 'phone' && (
                  <select value={col.phoneCountry || 'CN'} onChange={(e) => updateEditCol(col.id, { phoneCountry: e.target.value as PhoneCountry })}
                    className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                    {PHONE_COUNTRIES.map(c => (<option key={c.value} value={c.value}>{t(c.key)}</option>))}
                  </select>
                )}
                {col.type === 'city' && (
                  <select value={col.cityCountry || 'CN'} onChange={(e) => updateEditCol(col.id, { cityCountry: e.target.value as PhoneCountry })}
                    className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                    {PHONE_COUNTRIES.map(c => (<option key={c.value} value={c.value}>{t(c.key)}</option>))}
                  </select>
                )}
                  </div>
                </section>
                {/* Nullable setting for all column types */}
                <div className={styles.fieldOptionRow} draggable="false" onDragStart={(e) => e.stopPropagation()}>
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
                    <span className="text-xs text-gv-text-dim">{t('table.allow_null')}</span>
                  </label>
                  {col.nullable && (
                    <div className="flex items-center gap-2 mt-2 pl-1">
                      <span className="text-xs text-gv-text-muted w-10">{t('table.null_ratio')}</span>
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
                <button type="button" onClick={() => addEditColumn(i)} className={styles.insertFieldButton}>
                  <span aria-hidden="true">+</span>{t('table.insert_after_field')}
                </button>
              </div>
              )
            })}
            <div className={styles.schemaEditorActions}>
              <button onClick={saveEdit} className="btn-primary rounded-lg px-4 py-2 text-sm">{t('table.save_changes')}</button>
              <button onClick={() => setEditMode(false)} className="btn-outline rounded-lg px-4 py-2 text-sm">{t('table.discard_changes')}</button>
            </div>
          </section>
        </div>
      ) : (
        /* Column Info (read-only) */
        <div className={`card p-4 ${styles.schemaCard}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gv-text">
              {t('table.columns')}
              {(displayedRows.length > 0 || rowsLoading) && (
                <span className="ml-2 text-xs font-normal text-gv-text-dim">
                  {t('table.columns_generated', generatedColumns.size, table.columns.length)}
                </span>
              )}
            </h3>
            <span className={styles.schemaHint}>{t('table.drag_hint')}</span>
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
                <span className="font-medium text-gv-text text-sm">{col.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium self-start ${
                  col.type === 'foreign_key' || col.type === 'foreign_key_array' ? 'bg-gv-pink/10 text-gv-pink' :
                  col.type === 'text' ? 'bg-gv-green/10 text-gv-green-dark' :
                  col.type === 'number' ? 'bg-gv-pink/10 text-gv-pink-dark' :
                  col.type === 'id' ? 'bg-gv-green/10 text-gv-green-dark' :
                  'bg-gv-bg text-gv-text-dim'
                }`}>
                  {t(TYPE_KEY[col.type])}
                </span>
              </div>
              {/* Col 3: prompt / code / format info */}
              <div className="flex-1 min-w-0">
                {col.type === 'text' && (
                  col.llmPrompt?.trim()
                    ? <div className="text-xs text-gv-text-dim truncate" title={col.llmPrompt}>{col.llmPrompt}</div>
                    : <div className="text-xs text-gv-pink-dark">{col.nullable ? t('table.nullable') : t('table.prompt_empty')}</div>
                )}
                {col.generationCode && (
                  <div className="text-xs text-gv-text-muted truncate font-mono" title={col.generationCode}>{col.generationCode}</div>
                )}
                {col.type === 'date' && col.dateFormat && col.dateFormat !== 'date' && (
                  <div className="text-xs text-gv-pink font-medium">
                    {t(DATE_FORMATS.find(f => f.value === col.dateFormat)?.key || '') || col.dateFormat}
                  </div>
                )}
                {col.type === 'id' && (
                  <div className="text-xs text-gv-green-dark font-medium">
                    {t(ID_FORMATS.find(f => f.value === (col.idFormat || 'uuid4'))?.key || 'idfmt.uuid4')}
                  </div>
                )}
                {col.type === 'phone' && (
                  <div className="text-xs text-gv-pink font-medium">
                    {t(PHONE_COUNTRIES.find(c => c.value === (col.phoneCountry || 'CN'))?.key || 'country.CN')}
                  </div>
                )}
                {col.type === 'city' && (
                  <div className="text-xs text-gv-green-dark font-medium">
                    {t(PHONE_COUNTRIES.find(c => c.value === (col.cityCountry || 'CN'))?.key || 'country.CN')}
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
                    title={t('table.gen_col_hint', col.name)}
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
          <p className="text-xs text-gv-pink-dark mt-2">{t('table.fk_missing_warn')}</p>
        )}
        {emptyPromptCols.length > 0 && (
          <p className="text-xs text-gv-pink-dark mt-2">
            {t('table.fk_ref', emptyPromptCols.map(c => c.name).join(', '))}
          </p>
        )}
      </div>
      )}

      </div> {/* end left panel */}

      {/* RIGHT 3/4 — Generate + Table */}
      {!editMode && <div className={styles.dataWorkspace}>
        {workspaceMode === 'data' ? (
          <>
        {/* Compact toolbar */}
        <div className={styles.generationToolbar}>
          <div className="flex items-center gap-1.5">
            <input type="number" value={rowCount} onChange={(e) => setRowCount(Number(e.target.value))}
              min={1} max={1000}
              className="w-16 input-field py-1.5 text-sm text-center" />
            <span className="text-xs text-gv-text-dim">{t('table.row_count')}</span>
          </div>
          <button onClick={handleGenerate} disabled={generating}
            className="btn-primary rounded-lg px-4 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {generating ? t('table.generating') : t('table.create_empty')}
          </button>
          {(displayedRows.length > 0 || rowsLoading) && (
            <span className="text-xs text-gv-text-muted">{displayedRows.length > 0 ? displayedRows.length : (table?.rowCount ?? 0)} {t('table.rows')}</span>
          )}
          {!llmConfigured && table.columns.some(c => c.type === 'text') && (
            <Link href="/settings" className="text-xs text-gv-pink hover:underline">{t('table.no_llm')}</Link>
          )}
        </div>
        {genError && (
          <div className={styles.generationError} role="alert">{genError}</div>
        )}

      {/* Data Table */}
      <div className={`card overflow-hidden ${styles.dataCard}`}>
        {displayedRows.length === 0 ? (
          rowsLoading ? (
            <div className={styles.dataState}>
              <div className="w-8 h-8 border-2 border-gv-pink/30 border-t-gv-pink rounded-full animate-spin" />
              <p>{t('app.loading')}</p>
            </div>
          ) : (
          <div className={styles.dataState}>
            <svg className="w-6 h-6 text-gv-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 3 4 4 4 7z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 3v18M16 3v18M3 8h18M3 16h18" />
            </svg>
            <p>{t('table.no_data')}</p>
          </div>
        )
      ) : (
          <>
            <div className={styles.tableControls}>
              <div>
                <span>{t('table.per_page')}</span>
                {[50, 100].map(n => (
                  <button key={n} onClick={() => { setPageSize(n); setCurrentPage(1) }}
                    aria-pressed={pageSize === n}>{n}</button>
                ))}
                <span>{t('table.page_info', displayedRows.length)}</span>
              </div>
              {(() => {
                const totalPages = Math.ceil(displayedRows.length / pageSize)
                const start = (currentPage - 1) * pageSize
                const end = Math.min(start + pageSize, displayedRows.length)
                return (
                  <div>
                    <span>{start + 1}-{end} / {displayedRows.length}</span>
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                      aria-label={t('table.previous_page')}>&lt;</button>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                      aria-label={t('table.next_page')}>&gt;</button>
                  </div>
                )
              })()}
            </div>
            <div className={styles.dataTableScroll}>
                <table>
                  <thead>
                    <tr>
                      <th className={styles.rowNumber}>#</th>
                      {table.columns.map(col => (
                        <th key={col.id}>{col.name}<small>{t(TYPE_KEY[col.type])}</small></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((row, i) => (
                      <tr key={i}>
                        <td className={styles.rowNumber}>{(currentPage - 1) * pageSize + i + 1}</td>
                        {table.columns.map(col => (
                          <td key={col.id}><span title={String(row[col.name] ?? 'null')}>{renderCellValue(row[col.name])}</span></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
            </div>
          </>
        )}
        </div>
          </>
        ) : (
          <StatsPanel columns={table.columns} rows={displayedRows} t={t} onClose={() => setWorkspaceMode('data')} />
        )}
      </div>} {/* end right panel */}
    </div> {/* end flex */}
    </main>
  )
}

function StatsPanel({ columns, rows, t, onClose }: {
  columns: ColumnDef[]
  rows: Record<string, unknown>[]
  t: (key: string, ...args: (string | number)[]) => string
  onClose: () => void
}) {
  const [selectedColumnId, setSelectedColumnId] = useState(columns[0]?.id ?? '')
  const selectedColumn = columns.find(column => column.id === selectedColumnId) ?? columns[0]

  if (!selectedColumn) return null

  const stats = computeColumnStats(selectedColumn, rows)

  return (
    <section className={styles.statisticsPanel} aria-labelledby="field-statistics-title">
      <aside className={styles.statisticsDirectory}>
        <div className={styles.statisticsDirectoryHeader}>
          <strong>{t('table.columns')}</strong>
          <span>{columns.length}</span>
        </div>
        <div className={styles.statisticsFieldList} role="tablist" aria-label={t('stats.select_field')}>
          {columns.map(column => (
            <button
              type="button"
              role="tab"
              id={`stats-tab-${column.id}`}
              aria-controls="field-statistics-panel"
              aria-selected={selectedColumn.id === column.id}
              key={column.id}
              onClick={() => setSelectedColumnId(column.id)}
            >
              <strong>{column.name}</strong>
              <small>{t(TYPE_KEY[column.type])}</small>
            </button>
          ))}
        </div>
      </aside>
      <section
        className={styles.statisticsCanvas}
        id="field-statistics-panel"
        role="tabpanel"
        aria-labelledby={`stats-tab-${selectedColumn.id}`}
      >
        <header>
          <div>
            <span>{t(stats.type === 'number' ? TYPE_KEY.number : TYPE_KEY[selectedColumn.type])}</span>
            <h2 id="field-statistics-title">{selectedColumn.name}</h2>
          </div>
          <button type="button" onClick={onClose}>{t('stats.close')}</button>
        </header>
        <StatCard stats={stats} t={t} />
        <footer>{t('stats.source_rows', rows.length)}</footer>
      </section>
    </section>
  )
}

function getStatMetrics(stats: ColumnStats, t: (key: string, ...args: (string | number)[]) => string) {
  switch (stats.type) {
    case 'number':
      return [[t('stats.count'), stats.count], [t('stats.mean'), stats.mean.toFixed(2)], [t('stats.median'), stats.median.toFixed(2)], [t('stats.min_max'), `${stats.min} / ${stats.max}`]]
    case 'text':
      return [[t('stats.count'), stats.count], [t('stats.unique'), stats.uniqueCount], [t('stats.avg_len'), `${stats.avgLength.toFixed(0)} ${t('stats.chars')}`], [t('stats.min_max_len'), `${stats.minLength} / ${stats.maxLength}`]]
    case 'date':
      return [[t('stats.count'), stats.count], [t('stats.earliest'), stats.min || '-'], [t('stats.latest'), stats.max || '-'], [t('stats.span'), `${stats.spanDays} ${t('stats.days')}`]]
    case 'boolean':
      return [[t('stats.count'), stats.count], ['True', stats.trueCount], ['False', stats.falseCount], [t('stats.true_ratio'), `${(stats.trueRatio * 100).toFixed(1)}%`]]
    case 'id':
      return [[t('stats.count'), stats.count], [t('stats.unique'), stats.uniqueCount], [t('stats.duplicates'), stats.duplicateCount], [t('stats.unique_rate'), `${stats.count > 0 ? ((stats.uniqueCount / stats.count) * 100).toFixed(1) : 0}%`]]
    case 'foreign_key':
    case 'phone':
      return [[t('stats.count'), stats.count], [t('stats.distinct'), stats.distinctCount], [t('stats.nulls'), stats.nullCount]]
    case 'city':
      return [[t('stats.count'), stats.count], [t('stats.distinct'), stats.distinctCount]]
    default:
      return [[t('stats.count'), stats.count]]
  }
}

function StatCard({ stats, t }: { stats: ColumnStats; t: (key: string, ...args: (string | number)[]) => string }) {
  const metrics = getStatMetrics(stats, t)
  return (
    <div className={styles.statisticsContent}>
      <dl className={styles.statisticsMetrics}>
        {metrics.map(([label, value]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.statisticsDistribution}>
        <div>
          <h3>{t('stats.distribution')}</h3>
          <p>{t('stats.distribution_help')}</p>
        </div>
        {stats.type === 'number' && <NumStatCard stats={stats} t={t} />}
        {stats.type === 'text' && <TextStatCard stats={stats} t={t} />}
        {stats.type === 'date' && <DateStatCard stats={stats} t={t} />}
        {stats.type === 'boolean' && <BoolStatCard stats={stats} />}
        {stats.type === 'id' && <IdStatCard stats={stats} t={t} />}
        {stats.type === 'foreign_key' && <FkStatCard stats={stats} t={t} />}
        {stats.type === 'phone' && <PhoneStatCard stats={stats} t={t} />}
        {stats.type === 'city' && <CityStatCard stats={stats} t={t} />}
        {stats.type === 'unknown' && <p className={styles.statisticsEmptyDetail}>{t('stats.no_distribution')}</p>}
      </div>
    </div>
  )
}

function tinyBar(v: number, max: number) {
  const scale = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0
  return (
    <span className={styles.statBarTrack} aria-hidden="true">
      <span className={styles.statBarFill} style={{ '--stat-scale': scale } as React.CSSProperties} />
    </span>
  )
}

function NumStatCard({ stats, t }: { stats: NumStats; t: (key: string, ...args: (string | number)[]) => string }) {
  const maxHist = Math.max(...stats.histogram.map(h => h.count), 1)
  if (stats.histogram.length === 0) return <p className={styles.statisticsEmptyDetail}>{t('stats.no_distribution')}</p>
  return (
    <div className={styles.statDetailRows}>
      {stats.histogram.map((h, i) => (
        <div key={i} className={styles.statDetailRow}>
          <span>{h.binStart} - {h.binEnd}</span>
          {tinyBar(h.count, maxHist)}
          <strong>{h.count}</strong>
        </div>
      ))}
    </div>
  )
}

function TextStatCard({ stats, t }: { stats: TextStats; t: (key: string, ...args: (string | number)[]) => string }) {
  const maxW = Math.max(...stats.topWords.map(w => w.count), 1)
  const maxCity = Math.max(...stats.cityWords.map(w => w.count), 1)
  if (stats.topWords.length === 0 && stats.cityWords.length === 0) return <p className={styles.statisticsEmptyDetail}>{t('stats.no_distribution')}</p>
  return (
    <div className={styles.statDetailGroups}>
      {stats.topWords.length > 0 && (
        <div className={styles.statDetailGroup}>
          <h4>{t('stats.top_words')}</h4>
          <div className={styles.statDetailRows}>
          {stats.topWords.map((w, i) => (
            <div key={i} className={styles.statDetailRow}>
              <span>{w.word}</span>
              {tinyBar(w.count, maxW)}
              <strong>{w.count}</strong>
            </div>
          ))}
          </div>
        </div>
      )}
      {stats.cityWords.length > 0 && (
        <div className={styles.statDetailGroup}>
          <h4>{t('stats.city_mentions')}</h4>
          <div className={styles.statDetailRows}>
          {stats.cityWords.map((c, i) => (
            <div key={i} className={styles.statDetailRow}>
              <span>{c.city} / {c.province}</span>
              {tinyBar(c.count, maxCity)}
              <strong>{c.count}</strong>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DateStatCard({ stats, t }: { stats: DateStats; t: (key: string, ...args: (string | number)[]) => string }) {
  const maxM = Math.max(...stats.byMonth.map(m => m.count), 1)
  if (stats.byMonth.length === 0) return <p className={styles.statisticsEmptyDetail}>{t('stats.no_distribution')}</p>
  return (
    <div className={styles.statDetailRows}>
      {stats.byMonth.map((m, i) => (
        <div key={i} className={styles.statDetailRow}>
          <span>{m.month}</span>
          {tinyBar(m.count, maxM)}
          <strong>{m.count}</strong>
        </div>
      ))}
    </div>
  )
}

function BoolStatCard({ stats }: { stats: BoolStats }) {
  const max = Math.max(stats.trueCount, stats.falseCount, 1)
  return (
    <div className={styles.statDetailRows}>
      <div className={styles.statDetailRow}><span>True</span>{tinyBar(stats.trueCount, max)}<strong>{stats.trueCount}</strong></div>
      <div className={styles.statDetailRow}><span>False</span>{tinyBar(stats.falseCount, max)}<strong>{stats.falseCount}</strong></div>
    </div>
  )
}

function IdStatCard({ stats, t }: { stats: IdStats; t: (key: string, ...args: (string | number)[]) => string }) {
  void stats
  return <p className={styles.statisticsEmptyDetail}>{t('stats.no_distribution')}</p>
}

function FkStatCard({ stats, t }: { stats: FkStats; t: (key: string, ...args: (string | number)[]) => string }) {
  const maxV = Math.max(...stats.topValues.map(v => v.count), 1)
  if (stats.topValues.length === 0) return <p className={styles.statisticsEmptyDetail}>{t('stats.no_distribution')}</p>
  return (
    <div className={styles.statDetailRows}>
      {stats.topValues.map((v, i) => (
        <div key={i} className={styles.statDetailRow}>
          <span>{v.value}</span>
          {tinyBar(v.count, maxV)}
          <strong>{v.count}</strong>
        </div>
      ))}
    </div>
  )
}

function PhoneStatCard({ stats, t }: { stats: PhoneStats; t: (key: string, ...args: (string | number)[]) => string }) {
  void stats
  return <p className={styles.statisticsEmptyDetail}>{t('stats.no_distribution')}</p>
}

function CityStatCard({ stats, t }: { stats: CityStats; t: (key: string, ...args: (string | number)[]) => string }) {
  const maxP = Math.max(...stats.byProvince.map(p => p.count), 1)
  if (stats.byProvince.length === 0) return <p className={styles.statisticsEmptyDetail}>{t('stats.no_distribution')}</p>
  return (
    <div className={styles.statDetailRows}>
      {stats.byProvince.map((p, i) => (
        <div key={i} className={styles.statDetailRow}>
          <span>{p.province}</span>
          {tinyBar(p.count, maxP)}
          <strong>{p.count}</strong>
        </div>
      ))}
    </div>
  )
}

function renderCellValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined) return <span className="text-gv-text-muted italic">null</span>
  if (typeof val === 'boolean') return <span className={val ? 'text-gv-green-dark font-medium' : 'text-gv-pink-dark'}>{String(val)}</span>
  if (typeof val === 'number') return <span className="font-mono text-gv-pink">{val}</span>
  return <span>{String(val)}</span>
}
