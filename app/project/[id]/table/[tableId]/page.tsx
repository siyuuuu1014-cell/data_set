'use client'

import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import { useParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { ColumnDef, ColumnType, IdFormat, DateFormat, DateRange, PhoneCountry } from '@/services/types'
import { generateTableData, generateColumn } from '@/services/data-gen'
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
]

const TYPE_LABEL: Record<ColumnType, string> = {
  text: '文本', number: '数字', boolean: '布尔值', date: '日期',
  id: 'ID', phone: '电话', city: '城市', foreign_key: '外键',
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
  { value: 'unix_s', label: 'Unix 时间戳 (秒)' },
  { value: 'unix_ms', label: 'Unix 时间戳 (毫秒)' },
]

const PRESET_DATE_RANGES: Omit<DateRange, 'ratio'>[] = [
  { label: '近7天', minDays: 0, maxDays: 7 },
  { label: '7-30天', minDays: 7, maxDays: 30 },
  { label: '1-3个月', minDays: 30, maxDays: 90 },
  { label: '3-6个月', minDays: 90, maxDays: 180 },
  { label: '6-12个月', minDays: 180, maxDays: 365 },
  { label: '1-2年', minDays: 365, maxDays: 730 },
  { label: '2年以上', minDays: 730, maxDays: 0 },
]

function emptyColumn(): ColumnDef {
  return { id: genColId(), name: '', type: 'text', llmPrompt: '', generationCode: '' }
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

  const [llmConfigured, setLlmConfigured] = useState(false)
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

  const emptyPromptCols = table.columns.filter(c => c.type === 'text' && !c.llmPrompt?.trim())

  const handleGenerate = async () => {
    setGenError('')
    if (emptyPromptCols.length > 0) {
      setGenError(`以下文本列的提示词为空: ${emptyPromptCols.map(c => c.name).join(', ')}。请编辑表结构补充提示词。`)
      return
    }
    setGenerating(true)
    try {
      const rows = await generateTableData(table, { rowCount, allTables, projectId: id })

      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          tableName: table.name,
          columns: table.columns,
          rows,
        }),
      })

      setTableRows(id, table.id, rows)
      setDisplayedRows(rows)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const saveToParquet = async (rows: Record<string, unknown>[]) => {
    await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: id,
        tableName: table.name,
        columns: table.columns,
        rows,
      }),
    })
  }

  const handleGenerateColumn = async (col: ColumnDef) => {
    setGenError('')
    if (col.type === 'text' && !col.llmPrompt?.trim()) {
      setGenError(`列"${col.name}"的提示词为空`)
      return
    }
    setColumnGenerating(col.id)
    try {
      const refData: Record<string, Record<string, unknown>[]> = {}
      if (col.type === 'foreign_key' && col.foreignTable) {
        const parentTable = allTables.find(t => t.id === col.foreignTable)
        if (parentTable && parentTable.rows.length > 0) {
          refData[parentTable.name] = parentTable.rows
        } else {
          throw new Error(`外键列引用的表"${parentTable?.name || col.foreignTable}"还没有数据`)
        }
      }

      const rowCount = displayedRows.length > 0 ? displayedRows.length : 10
      const values = await generateColumn(col, rowCount, refData)

      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < rowCount; i++) {
        const existing = displayedRows[i] || {}
        rows.push({ ...existing, [col.name]: values[i] ?? null })
      }

      setDisplayedRows(rows)
      setTableRows(id, table.id, rows)
      await saveToParquet(rows)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setColumnGenerating(null)
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
  }

  const updateEditCol = (colId: string, updates: Partial<ColumnDef>) => {
    setEditColumns(prev => prev.map(c => (c.id === colId ? { ...c, ...updates } : c)))
  }

  const addEditColumn = () => {
    setEditColumns(prev => [...prev, emptyColumn()])
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
    c => c.type === 'foreign_key' && c.foreignTable && !allTables.find(t => t.id === c.foreignTable)
  )

  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
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
          {!editMode && (
            <button onClick={startEdit}
              className="btn-outline rounded-lg px-3 py-1.5 text-sm">
              {t('table.edit_schema')}
            </button>
          )}
          <div className="relative">
            <button onClick={() => setShowExportMenu(!showExportMenu)} disabled={displayedRows.length === 0}
              className="btn-outline rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {t('table.export_menu')}
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-gv-border bg-white shadow-lg z-10 overflow-hidden">
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
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit mode */}
      {editMode && (
        <div className="card p-6 mb-6">
          <h3 className="font-semibold text-gv-text mb-4">{t('table.edit_schema')}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gv-text-dim mb-1">{t('table.name')}</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                className="input-field w-full py-2 text-sm" />
            </div>
            {editColumns.map((col, i) => (
              <div key={col.id}
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
                  <input type="text" value={col.name} onChange={(e) => updateEditCol(col.id, { name: e.target.value })}
                    placeholder={t('table.col_name')}
                    className="flex-1 input-field py-2 text-sm" />
                  <select value={col.type} onChange={(e) => updateEditCol(col.id, { type: e.target.value as ColumnType })}
                    className="w-32 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-2 text-sm focus:outline-none focus:border-gv-pink">
                    {COLUMN_TYPES.map(ct => (<option key={ct.value} value={ct.value}>{ct.label}</option>))}
                  </select>
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
                  <textarea value={col.generationCode || ''} onChange={(e) => updateEditCol(col.id, { generationCode: e.target.value })}
                    placeholder="JavaScript 代码，返回值作为列值。"
                    rows={3}
                    className="input-field w-full py-2 text-sm font-mono" />
                )}
                {col.type === 'foreign_key' && (
                  <div className="flex gap-2">
                    <select value={col.foreignTable || ''} onChange={(e) => updateEditCol(col.id, { foreignTable: e.target.value })}
                      className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">选择引用表...</option>
                      {allTables.filter(t => t.id !== table.id).map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    <select value={col.foreignColumn || ''} onChange={(e) => updateEditCol(col.id, { foreignColumn: e.target.value })}
                      className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-2 text-sm focus:outline-none focus:border-gv-pink">
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
                    <input type="text" value={col.generationCode || ''} onChange={(e) => updateEditCol(col.id, { generationCode: e.target.value })}
                      placeholder="高级：自定义 JavaScript 生成代码"
                      className="input-field w-full py-2 text-xs font-mono" />
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
              </div>
            ))}
            <button type="button" onClick={addEditColumn}
              className="w-full rounded-lg border-2 border-dashed border-gv-border hover:border-gv-pink/50 py-2 text-sm text-gv-text-dim hover:text-gv-pink transition-colors">
              + {t('table.add_col')}
            </button>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={saveEdit}
              className="btn-primary rounded-lg px-4 py-2 text-sm">{t('table.save_changes')}</button>
            <button onClick={() => setEditMode(false)}
              className="btn-outline rounded-lg px-4 py-2 text-sm">{t('table.discard_changes')}</button>
          </div>
        </div>
      )}

      {/* Column Info */}
      <div className="card p-5 mb-6">
        <h3 className="text-sm font-semibold text-gv-text mb-3">列结构</h3>
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
              <div className="cursor-grab active:cursor-grabbing text-gv-text-muted hover:text-gv-pink select-none flex-shrink-0 transition-colors" title={t('project.drag_hint')}>
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                </svg>
              </div>
              <span className="font-medium min-w-[80px] text-gv-text">{col.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                col.type === 'foreign_key' ? 'bg-gv-pink/10 text-gv-pink' :
                col.type === 'text' ? 'bg-gv-green/10 text-gv-green-dark' :
                col.type === 'number' ? 'bg-gv-pink/10 text-gv-pink-dark' :
                col.type === 'id' ? 'bg-gv-green/10 text-gv-green-dark' :
                'bg-gv-bg text-gv-text-dim'
              }`}>
                {TYPE_LABEL[col.type]}
              </span>
              {col.type === 'text' && (
                col.llmPrompt?.trim()
                  ? <span className="text-xs text-gv-text-dim truncate max-w-xs">{col.llmPrompt}</span>
                  : <span className="text-xs text-gv-pink-dark">提示词为空</span>
              )}
              {col.generationCode && (
                <code className="text-xs text-gv-text-muted truncate max-w-xs font-mono">{col.generationCode}</code>
              )}
              {col.type === 'date' && col.dateFormat && col.dateFormat !== 'date' && (
                <span className="text-xs text-gv-pink font-medium">
                  {DATE_FORMATS.find(f => f.value === col.dateFormat)?.label || col.dateFormat}
                </span>
              )}
              {col.type === 'id' && (
                <span className="text-xs text-gv-green-dark font-medium">
                  {ID_FORMATS.find(f => f.value === (col.idFormat || 'uuid4'))?.label || 'UUID v4'}
                </span>
              )}
              {col.type === 'phone' && (
                <span className="text-xs text-gv-pink font-medium">
                  {PHONE_COUNTRIES.find(c => c.value === (col.phoneCountry || 'CN'))?.label || '中国 (+86)'}
                </span>
              )}
              {col.type === 'city' && (
                <span className="text-xs text-gv-green-dark font-medium">
                  {PHONE_COUNTRIES.find(c => c.value === (col.cityCountry || 'CN'))?.label || '中国'}
                </span>
              )}
              {col.foreignTable && (
                <span className="text-xs text-gv-pink">
                  → {allTables.find(t => t.id === col.foreignTable)?.name || col.foreignTable}
                  {col.foreignColumn ? `.${col.foreignColumn}` : ''}
                </span>
              )}
              <div className="ml-auto flex-shrink-0">
                <button
                  onClick={() => handleGenerateColumn(col)}
                  disabled={columnGenerating != null}
                  className="rounded-lg border border-gv-border px-2.5 py-1 text-xs font-medium text-gv-text-dim hover:text-gv-pink hover:border-gv-pink/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`生成 ${col.name} 列数据`}
                >
                  {columnGenerating === col.id ? (
                    <span className="flex items-center gap-1">
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {t('table.generating')}
                    </span>
                  ) : t('table.generate')}
                </button>
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

      {/* Generate Panel */}
      <div className="card p-5 mb-6">
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
            {generating ? t('table.generating') : t('table.generate')}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gv-border bg-gradient-to-r from-gv-pink/5 to-gv-green/5">
                <th className="text-left px-4 py-2.5 text-xs text-gv-text-dim font-medium w-12">#</th>
                {table.columns.map(col => (
                  <th key={col.id} className="text-left px-4 py-2.5 text-xs text-gv-text-dim font-medium">{col.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedRows.slice(0, 100).map((row, i) => (
                <tr key={i} className="border-b border-gv-border/50 hover:bg-gv-pink/[0.03] transition-colors">
                  <td className="px-4 py-2 text-gv-text-muted text-xs">{i + 1}</td>
                  {table.columns.map(col => (
                    <td key={col.id} className="px-4 py-2 max-w-xs truncate text-gv-text">{renderCellValue(row[col.name])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {displayedRows.length > 100 && (
        <p className="text-xs text-gv-text-muted mt-2 text-center">
          {t('table.showing_rows', 100, displayedRows.length)}
        </p>
      )}
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
