'use client'

import React from 'react'
import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import type { ColumnDef, ColumnType, IdFormat, PhoneCountry, DateFormat, DateRange } from '@/services/types'
import Link from 'next/link'

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
  foreign_key: '外键', id: 'ID', phone: '电话', city: '城市',
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
    const dist = PRESET_DATE_RANGES.map(r => ({ ...r, ratio: 0 }))
    col.dateDistribution = dist
    return dist
  }
  return col.dateDistribution
}

function emptyColumn(): ColumnDef {
  return { id: genColId(), name: '', type: 'text', llmPrompt: '', generationCode: '' }
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
    addTable(id, {
      id: tableId,
      name: tableName.trim(),
      columns,
      rows: [],
    })
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
          <input
            type="text"
            value={tableName}
            onChange={(e) => { setName(e.target.value); setError('') }}
            placeholder={t('table.name_placeholder')}
            className="input-field w-full py-3 text-base"
            autoFocus
          />
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
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">生成代码 (JavaScript，返回值作为列数据)</label>
                    <textarea
                      value={col.generationCode || ''}
                      onChange={(e) => updateCol(col.id, { generationCode: e.target.value })}
                      placeholder={`可用的变量和函数：\nindex - 当前行号(0开始)\ntotalRows - 总行数\npreviousValues - 之前生成的值\nrefData - 引用表数据\nrandomInt(min, max) - 随机整数\nrandomFloat(min, max) - 随机浮点数\npick(arr) - 随机选择\n\n示例：\nrandomInt(18, 65)`}
                      rows={6}
                      className="input-field w-full py-2 text-sm font-mono"
                    />
                  </div>
                )}

                {col.type === 'foreign_key' && (
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
                    <input type="text" value={col.generationCode || ''} onChange={(e) => updateCol(col.id, { generationCode: e.target.value })}
                      placeholder="高级：自定义 JavaScript 生成代码"
                      className="input-field w-full py-2 text-xs font-mono" />
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
