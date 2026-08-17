'use client'

import React from 'react'
import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import type { ColumnDef, ColumnType, IdFormat, PhoneCountry, DateFormat, DateRange } from '@/services/types'
import Link from 'next/link'
import { previewGenerationExpression } from '@/services/expression-preview'
import styles from '../table-workflow.module.css'

let _colIdCounter = Date.now()
function genColId(): string {
  return 'col_' + (_colIdCounter++).toString(36)
}
let _tableIdCounter = Date.now()
function genTableId(): string {
  return 'tbl_' + (_tableIdCounter++).toString(36)
}

const COLUMN_TYPES: { value: ColumnType; key: string }[] = [
  { value: 'text', key: 'coltype.text_create' },
  { value: 'number', key: 'coltype.number_create' },
  { value: 'boolean', key: 'coltype.boolean' },
  { value: 'date', key: 'coltype.date' },
  { value: 'id', key: 'coltype.id' },
  { value: 'phone', key: 'coltype.phone' },
  { value: 'city', key: 'coltype.city' },
  { value: 'foreign_key', key: 'coltype.foreign_key' },
  { value: 'foreign_key_array', key: 'coltype.foreign_key_array' },
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

const TYPE_KEY: Record<ColumnType, string> = {
  text: 'coltype.text_short', number: 'coltype.number_short', boolean: 'coltype.boolean_short', date: 'coltype.date_short',
  id: 'coltype.id_short', phone: 'coltype.phone_short', city: 'coltype.city_short', foreign_key: 'coltype.foreign_key',
  foreign_key_array: 'coltype.foreign_key_array',
}

// Sentinel used to detect "code generation in progress" — a logic check, not
// display text, so it must not go through i18n.
const GEN_IN_PROGRESS = '⌛generating'

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

function ensureDateDistribution(col: ColumnDef): DateRange[] {
  if (!col.dateDistribution || col.dateDistribution.length === 0) {
    return PRESET_DATE_RANGES.map(r => ({ label: r.key, minDays: r.minDays, maxDays: r.maxDays, ratio: 0 }))
  }
  return col.dateDistribution
}

function emptyColumn(): ColumnDef {
  return { id: genColId(), name: '', type: 'text', llmPrompt: '', generationCode: '' }
}

type BuilderSection = 'identity' | 'relations' | 'fields' | 'check'

const BUILDER_SECTIONS: { value: BuilderSection; labelKey: string; descriptionKey: string }[] = [
  { value: 'identity', labelKey: 'table.builder_identity', descriptionKey: 'table.builder_identity_desc' },
  { value: 'relations', labelKey: 'table.builder_relations', descriptionKey: 'table.builder_relations_desc' },
  { value: 'fields', labelKey: 'table.builder_fields', descriptionKey: 'table.builder_fields_desc' },
  { value: 'check', labelKey: 'table.builder_check', descriptionKey: 'table.builder_check_desc' },
]

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
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('图片加载失败'))
    }
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
  const [activeSection, setActiveSection] = useState<BuilderSection>('identity')
  const [expandedColumnId, setExpandedColumnId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/llm/config').then(r => r.json()).then(d => setLlmConfigured(d.configured)).catch(() => {})
  }, [])

  const hasTextCols = columns.some(c => c.type === 'text')
  const tableNameReady = Boolean(tableName.trim())
  const columnNamesReady = columns.every(column => Boolean(column.name.trim()))
  const generationRulesReady = columns.every(column => {
    if (column.type === 'text' && !column.nullable) return Boolean(column.llmPrompt?.trim())
    if (column.type === 'foreign_key') return Boolean(column.foreignTable)
    return true
  })
  const readyChecks = [tableNameReady, columnNamesReady, generationRulesReady, !hasTextCols || llmConfigured]
  const completion = Math.round((readyChecks.filter(Boolean).length / readyChecks.length) * 100)

  if (!project) return null

  const updateCol = (colId: string, updates: Partial<ColumnDef>) => {
    setColumns(prev => prev.map(c => (c.id === colId ? { ...c, ...updates } : c)))
  }

  const addColumn = (afterIndex?: number) => {
    const nextColumn = emptyColumn()
    setExpandedColumnId(nextColumn.id)
    setColumns(prev => {
      if (afterIndex !== undefined && afterIndex >= 0 && afterIndex < prev.length) {
        return [...prev.slice(0, afterIndex + 1), nextColumn, ...prev.slice(afterIndex + 1)]
      }
      return [...prev, nextColumn]
    })
  }

  const openBuilderSection = (section: BuilderSection) => {
    setActiveSection(section)
    document.getElementById(`builder-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const removeColumn = (colId: string) => {
    if (columns.length <= 1) return
    const nextColumns = columns.filter(c => c.id !== colId)
    setColumns(nextColumns)
    if (expandedColumnId === colId) setExpandedColumnId(nextColumns[0]?.id ?? null)
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
      if (!tables || !Array.isArray(tables)) throw new Error(t('table.invalid_nuwa'))
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
        setExpandedColumnId(newCols[0].id)
        setImportedRows(fileRows)
        const rowMsg = fileRows.length > 0 ? t('table.import_rows_suffix').replace('{0}', String(fileRows.length)) : ''
        setError(`${t('table.import_cols_success').replace('{0}', String(newCols.length))}${rowMsg}`)
      } else {
        setError(t('table.import_no_data'))
      }
      if (nuwaFileRef.current) nuwaFileRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : t('table.import_fail'))
    } finally {
      setImportingNuwa(false)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setError(t('table.image_too_large'))
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
        setError(t('table.image_no_columns'))
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
      setExpandedColumnId(newCols[0]?.id ?? null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : t('table.image_fail'))
    } finally {
      setImageUploading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const finalName = tableName.trim()
    if (!finalName) {
      setError(t('table.name_required'))
      return
    }
    if (existingTables.some(t => t.name === finalName)) {
      setError(t('table.name_exists'))
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

    const tableId = genTableId()
    const rows = importedRows.length > 0 ? importedRows : []
    addTable(id, {
      id: tableId,
      name: finalName,
      columns,
      rows,
    })
    // If imported rows exist, save them to Parquet
    if (rows.length > 0) {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, tableName: finalName, columns, rows }),
      }).catch(() => {})
    }
    router.push(`/project/${id}/table/${tableId}`)
  }

  return (
    <main className={styles.builderPage}>
      <div className={styles.builderHeader}>
        <Link href={`/project/${id}`} className={styles.backLink} aria-label={t('table.back_to_project')}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-lg font-semibold text-gv-text">{t('table.new_title')}</h2>
      </div>

      <div className={styles.builderLayout}>
        <aside className={styles.builderRail} aria-label={t('table.builder_navigation')}>
          <div>
            <span className={styles.railKicker}>{t('table.builder_workspace')}</span>
            <strong className={styles.railTableName}>{tableName.trim() || t('table.builder_unnamed')}</strong>
            <small className={styles.railProjectName}>{project.name}</small>
          </div>

          <nav className={styles.builderNavigation} aria-label={t('table.builder_navigation')}>
            {BUILDER_SECTIONS.map(section => (
              <button
                key={section.value}
                type="button"
                onClick={() => openBuilderSection(section.value)}
                aria-current={activeSection === section.value ? 'step' : undefined}
              >
                <span>{t(section.labelKey)}</span>
                <small>{t(section.descriptionKey)}</small>
              </button>
            ))}
          </nav>

          <div className={styles.builderProgress}>
            <div><span>{t('table.builder_completion')}</span><strong>{completion}%</strong></div>
            <div className={styles.progressTrack} aria-hidden="true"><span style={{ transform: `scaleX(${completion / 100})` }} /></div>
            <ul>
              <li data-ready={tableNameReady}>{t('table.builder_check_name')}</li>
              <li data-ready={columnNamesReady}>{t('table.builder_check_columns')}</li>
              <li data-ready={generationRulesReady}>{t('table.builder_check_rules')}</li>
              <li data-ready={!hasTextCols || llmConfigured}>{t('table.builder_check_llm')}</li>
            </ul>
            <button type="button" onClick={() => openBuilderSection('check')}>{t('table.builder_view_check')}</button>
          </div>
        </aside>

      <form onSubmit={handleSubmit} className={styles.builderForm}>
        {/* LLM status */}
        {hasTextCols && (
          <div className={`rounded-lg border p-3 text-sm ${
            llmConfigured
              ? 'bg-gv-green/10 border-gv-green/30 text-gv-green-dark'
              : 'bg-gv-pink/10 border-gv-pink/30 text-gv-pink-dark'
          }`}>
            {llmConfigured
              ? t('table.llm_configured_banner')
              : <>{t('app.unconfigured')}。<Link href="/settings" className="underline font-medium ml-1">{t('home.settings_hint')}</Link></>
            }
          </div>
        )}

        {/* Table name */}
        <section id="builder-identity" className={styles.identitySection} onFocusCapture={() => setActiveSection('identity')}>
          <header className={styles.sectionHeading}>
            <div><span>{t('table.builder_identity')}</span><h2>{t('table.builder_identity_title')}</h2></div>
            <p>{t('table.builder_identity_help')}</p>
          </header>
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
              {importingNuwa ? t('table.import_nuwa_loading') : t('table.import_nuwa')}
            </button>
          </div>
        </section>

        {/* Related Tables */}
        {existingTables.length > 0 && (
          <section id="builder-relations" className={styles.relatedSection} onFocusCapture={() => setActiveSection('relations')}>
            <header className={styles.sectionHeading}>
              <div><span>{t('table.builder_relations')}</span><h2>{t('table.related_tables')}</h2></div>
              <p>{t('table.related_hint')}</p>
            </header>
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
                                  ? 'bg-ui-icon-accent-soft border-ui-active-indicator text-ui-accent font-medium'
                                  : 'bg-ui-surface border-ui-border text-gv-text-dim hover:border-ui-border-strong'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isImported}
                                onChange={() => toggleImportCol(table.id, table.name, col)}
                                className="sr-only"
                              />
                              {col.name}
                              <span className="text-gv-text-muted">({t(TYPE_KEY[col.type])})</span>
                              {isImported && (
                                <span
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFkMode(table.id, col.name) }}
                                  className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors ${
                                    isFk
                                      ? 'bg-gv-pink/20 text-gv-pink-dark'
                                      : 'bg-gv-green/20 text-gv-green-dark'
                                  }`}
                                  title={isFk ? t('table.fk_mode_title') : t('table.direct_mode_title')}
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
          </section>
        )}

        {/* Columns */}
        <section id="builder-fields" className={styles.columnSection} onFocusCapture={() => setActiveSection('fields')}>
          <div className="flex items-center justify-between mb-3">
            <div className={styles.sectionHeadingCompact}>
              <span>{t('table.builder_fields')}</span>
              <h2>{t('table.col_def')}</h2>
              <p>{t('table.builder_fields_help', columns.length)}</p>
            </div>
          </div>

          <div className="space-y-4">
            {columns.map((col, i) => {
              const isExpanded = expandedColumnId === col.id || (expandedColumnId === null && i === 0)
              const isReady = Boolean(col.name.trim()) && (
                col.type !== 'text' || col.nullable || Boolean(col.llmPrompt?.trim())
              ) && (
                col.type !== 'foreign_key' || Boolean(col.foreignTable)
              )
              return (
              <React.Fragment key={col.id}>
              <div className={`card p-4 space-y-3 ${styles.columnCard}`} data-expanded={isExpanded || undefined}>
                <div className={styles.columnHeader}>
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-gv-pink/20 to-gv-green/20 flex items-center justify-center text-xs text-gv-text-muted font-mono border border-gv-border/50">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={col.name}
                    onChange={(e) => updateCol(col.id, { name: e.target.value })}
                    placeholder={t('table.col_name')}
                    aria-label={`${t('table.col_name')} ${i + 1}`}
                    className="flex-1 input-field py-2 text-sm"
                  />
                  <select
                    value={col.type}
                    onChange={(e) => updateCol(col.id, { type: e.target.value as ColumnType })}
                    aria-label={`${t('table.column_type')} ${i + 1}`}
                    className="w-44 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink"
                  >
                    {COLUMN_TYPES.map(ct => (
                      <option key={ct.value} value={ct.value}>{t(ct.key)}</option>
                    ))}
                  </select>
                  <span className={styles.columnRuleState} data-ready={isReady}>
                    {isReady ? t('table.builder_configured') : t('table.builder_needs_attention')}
                  </span>
                  <button
                    type="button"
                    className={styles.columnToggle}
                    aria-expanded={isExpanded}
                    aria-controls={`column-rules-${col.id}`}
                    onClick={() => setExpandedColumnId(isExpanded ? null : col.id)}
                  >
                    {isExpanded ? t('table.builder_collapse_rules') : t('table.builder_configure_rules')}
                  </button>
                  {columns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeColumn(col.id)}
                      aria-label={`${t('app.delete')} ${col.name || `${t('table.col_name')} ${i + 1}`}`}
                      className="text-gv-pink/60 hover:text-gv-pink p-1 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {isExpanded && <div id={`column-rules-${col.id}`} className={styles.columnRules}>
                {/* Type-specific fields */}
                {col.type === 'text' && (
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">{t('table.prompt_label')}</label>
                    <textarea
                      value={col.llmPrompt || ''}
                      onChange={(e) => updateCol(col.id, { llmPrompt: e.target.value })}
                      placeholder={t('table.prompt_example')}
                      rows={2}
                      className="input-field w-full py-2 text-sm"
                    />
                  </div>
                )}

                {col.type === 'number' && (
                  <div className="space-y-2">
                    <select value={col.foreignTable || ''} onChange={(e) => updateCol(col.id, { foreignTable: e.target.value || undefined })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      <option value="">{t('table.ref_table_number')}</option>
                      {existingTables.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    {col.foreignTable && (
                      <div className="flex gap-2">
                        <select value={col.localMatchColumn || ''} onChange={(e) => updateCol(col.id, { localMatchColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-xs focus:outline-none focus:border-gv-pink">
                          <option value="">{t('table.local_match_auto')}</option>
                          {columns.filter(c => c.name.trim()).map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                        <select value={col.foreignColumn || ''} onChange={(e) => updateCol(col.id, { foreignColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-xs focus:outline-none focus:border-gv-pink">
                          <option value="">{t('table.foreign_col_default')}</option>
                          {existingTables.find(t => t.id === col.foreignTable)?.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                      </div>
                    )}
                    <label className="block text-xs text-gv-text-dim">{t('table.rule_desc')}</label>
                    <div className="flex gap-2">
                      <input type="text" value={col.llmPrompt || ''} onChange={(e) => updateCol(col.id, { llmPrompt: e.target.value })}
                        placeholder={t('table.number_prompt_placeholder')}
                        className="flex-1 input-field py-1.5 text-xs" />
                      <button type="button"
                        onClick={async () => {
                          if (!col.llmPrompt?.trim()) return
                          updateCol(col.id, { generationCode: GEN_IN_PROGRESS })
                          const { llmGenerateCode } = await import('@/services/data-gen')
                          const result = await llmGenerateCode(col.llmPrompt!.trim(), 'number')
                          updateCol(col.id, { generationCode: result.code || `// ${result.error || t('table.gen_fail')}` })
                        }}
                        disabled={!col.llmPrompt?.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gv-pink/30 text-gv-pink hover:bg-gv-pink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                        {t('table.ai_gen_code')}
                      </button>
                    </div>
                    <label className="block text-xs text-gv-text-dim">{t('table.code_label_short')}</label>
                    <textarea
                      value={col.generationCode || ''}
                      onChange={(e) => updateCol(col.id, { generationCode: e.target.value })}
                      placeholder="index, totalRows, previousValues, refData, randomInt(min,max), randomFloat(min,max), pick(arr)"
                      rows={4}
                      className="input-field w-full py-2 text-sm font-mono"
                    />
                    {col.generationCode && col.generationCode !== GEN_IN_PROGRESS && (
                      <button type="button"
                        onClick={() => {
                          try {
                            const results = previewGenerationExpression(col.generationCode!)
                            alert(`${t('table.test_result')}\n${results.map((v, i) => `  [${i}] ${v}`).join('\n')}`)
                          } catch (err) {
                            alert(`${t('table.code_error')} ${err instanceof Error ? err.message : String(err)}`)
                          }
                        }}
                        className="text-xs text-gv-pink hover:text-gv-pink-dark transition-colors">
                        {t('table.test_code')}
                      </button>
                    )}
                  </div>
                )}

                {(col.type === 'foreign_key' || col.type === 'foreign_key_array') && (
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-gv-text-dim mb-1">{t('table.fk_ref_table')}</label>
                      <select
                        value={col.foreignTable || ''}
                        onChange={(e) => updateCol(col.id, { foreignTable: e.target.value })}
                        className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink"
                      >
                        <option value="">{t('table.fk_select_table')}</option>
                        {existingTables.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gv-text-dim mb-1">{t('table.fk_ref_col')}</label>
                      <select
                        value={col.foreignColumn || ''}
                        onChange={(e) => updateCol(col.id, { foreignColumn: e.target.value })}
                        className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink"
                      >
                        <option value="">{t('table.fk_auto_match')}</option>
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
                      <option value="">{t('table.ref_table_date')}</option>
                      {existingTables.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    {col.foreignTable && (
                      <div className="flex gap-2">
                        <select value={col.localMatchColumn || ''} onChange={(e) => updateCol(col.id, { localMatchColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-xs focus:outline-none focus:border-gv-pink">
                          <option value="">{t('table.local_match_auto')}</option>
                          {columns.filter(c => c.name.trim()).map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                        <select value={col.foreignColumn || ''} onChange={(e) => updateCol(col.id, { foreignColumn: e.target.value || undefined })}
                          className="flex-1 rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2 py-1.5 text-xs focus:outline-none focus:border-gv-pink">
                          <option value="">{t('table.foreign_col_default')}</option>
                          {existingTables.find(t => t.id === col.foreignTable)?.columns.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                        </select>
                      </div>
                    )}
                    {col.foreignTable && (
                      <select value={col.parentDateColumn || ''} onChange={(e) => updateCol(col.id, { parentDateColumn: e.target.value || undefined })}
                        className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                        <option value="">{t('table.parent_date_pick')}</option>
                        {existingTables.find(t => t.id === col.foreignTable)?.columns.filter(c => c.type === 'date').map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                      </select>
                    )}
                    <select value={col.dateFormat || 'date'} onChange={(e) => updateCol(col.id, { dateFormat: e.target.value as DateFormat })}
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
                        placeholder={t('table.date_prompt_placeholder')}
                        className="flex-1 input-field py-1.5 text-xs" />
                      <button type="button"
                        onClick={async () => {
                          if (!col.llmPrompt?.trim()) return
                          updateCol(col.id, { generationCode: GEN_IN_PROGRESS })
                          const { llmGenerateCode } = await import('@/services/data-gen')
                          const result = await llmGenerateCode(col.llmPrompt!.trim(), 'date', { dateFormat: col.dateFormat, dateDistribution: col.dateDistribution })
                          updateCol(col.id, { generationCode: result.code || `// ${result.error || t('table.gen_fail')}` })
                        }}
                        disabled={!col.llmPrompt?.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gv-pink/30 text-gv-pink hover:bg-gv-pink/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                        {t('table.ai_gen_code')}
                      </button>
                    </div>
                    <input type="text" value={col.generationCode || ''} onChange={(e) => updateCol(col.id, { generationCode: e.target.value })}
                      placeholder={t('table.code_placeholder_short')}
                      className="input-field w-full py-2 text-xs font-mono" />
                    {col.generationCode && col.generationCode !== GEN_IN_PROGRESS && (
                      <button type="button"
                        onClick={() => {
                          try {
                            const results = previewGenerationExpression(col.generationCode!)
                            alert(`${t('table.test_result')}\n${results.map((v, i) => `  [${i}] ${v}`).join('\n')}`)
                          } catch (err) {
                            alert(`${t('table.code_error')} ${err instanceof Error ? err.message : String(err)}`)
                          }
                        }}
                        className="text-xs text-gv-pink hover:text-gv-pink-dark transition-colors">
                        {t('table.test_code')}
                      </button>
                    )}
                  </div>
                )}

                {col.type === 'boolean' && (
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">{t('table.code_label')}</label>
                    <textarea
                      value={col.generationCode || ''}
                      onChange={(e) => updateCol(col.id, { generationCode: e.target.value })}
                      placeholder={t('table.code_gen_bool_ph')}
                      rows={2}
                      className="input-field w-full py-2 text-sm font-mono"
                    />
                    <div className="flex items-center gap-2 mt-2 pl-1">
                      <span className="text-xs text-gv-text-muted w-16">{t('table.bool_true_ratio')}</span>
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
                    <label className="block text-xs text-gv-text-dim mb-1">{t('table.id_format')}</label>
                    <select value={col.idFormat || 'uuid4'} onChange={(e) => updateCol(col.id, { idFormat: e.target.value as IdFormat })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      {ID_FORMATS.map(f => (<option key={f.value} value={f.value}>{t(f.key)}</option>))}
                    </select>
                  </div>
                )}

                {col.type === 'phone' && (
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">{t('table.country_label')}</label>
                    <select value={col.phoneCountry || 'CN'} onChange={(e) => updateCol(col.id, { phoneCountry: e.target.value as PhoneCountry })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      {PHONE_COUNTRIES.map(c => (<option key={c.value} value={c.value}>{t(c.key)}</option>))}
                    </select>
                  </div>
                )}

                {col.type === 'city' && (
                  <div>
                    <label className="block text-xs text-gv-text-dim mb-1">{t('table.country_label')}</label>
                    <select value={col.cityCountry || 'CN'} onChange={(e) => updateCol(col.id, { cityCountry: e.target.value as PhoneCountry })}
                      className="w-full rounded-lg border border-gv-border bg-gv-bg text-gv-text px-3 py-2 text-sm focus:outline-none focus:border-gv-pink">
                      {PHONE_COUNTRIES.map(c => (<option key={c.value} value={c.value}>{t(c.key)}</option>))}
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
                        onChange={(e) => updateCol(col.id, { nullRatio: Number(e.target.value) })}
                        className="flex-1 accent-gv-pink h-1"
                      />
                      <span className="text-xs font-mono text-gv-text w-9 text-right">{col.nullRatio ?? 5}%</span>
                    </div>
                  )}
                </div>
                </div>}
              </div>
              <button type="button" onClick={() => addColumn(i)}
                className={`w-full mt-1 mb-1 rounded-lg border-2 border-dashed border-gv-border hover:border-gv-pink/50 py-2 text-sm text-gv-text-dim hover:text-gv-pink transition-colors ${styles.insertButton}`}
                title={t('table.insert_col_hint')}>
                {t('table.insert_col')}
              </button>
              </React.Fragment>
              )
            })}
          </div>
        </section>

        <section id="builder-check" className={styles.checkSection} onFocusCapture={() => setActiveSection('check')}>
          <header className={styles.sectionHeading}>
            <div><span>{t('table.builder_check')}</span><h2>{t('table.builder_check_title')}</h2></div>
            <p>{t('table.builder_check_help')}</p>
          </header>
          <dl className={styles.checkMetrics}>
            <div><dt>{t('table.builder_metric_columns')}</dt><dd>{columns.length}</dd></div>
            <div><dt>{t('table.builder_metric_named')}</dt><dd>{columns.filter(column => column.name.trim()).length}</dd></div>
            <div><dt>{t('table.builder_metric_relations')}</dt><dd>{relatedTableIds.length}</dd></div>
            <div><dt>{t('table.builder_metric_completion')}</dt><dd>{completion}%</dd></div>
          </dl>
          <ul className={styles.checkList}>
            <li data-ready={tableNameReady}>{t('table.builder_check_name')}</li>
            <li data-ready={columnNamesReady}>{t('table.builder_check_columns')}</li>
            <li data-ready={generationRulesReady}>{t('table.builder_check_rules')}</li>
            <li data-ready={!hasTextCols || llmConfigured}>{t('table.builder_check_llm')}</li>
          </ul>
          {error && <div className={styles.feedback} role="alert">{error}</div>}
          <div className={styles.checkActions}>
            <p>{t('table.builder_submit_help')}</p>
            <button type="submit" className={`btn-primary rounded-lg px-4 py-3 text-sm ${styles.primarySubmit}`}>
              {t('table.create_btn')}
            </button>
          </div>
        </section>
      </form>
      </div>
    </main>
  )
}
