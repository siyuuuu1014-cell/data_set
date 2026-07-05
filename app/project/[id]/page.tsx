'use client'

import { useStore } from '@/services/store'
import { useLang } from '@/services/i18n'
import { useParams } from 'next/navigation'
import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { exportSql, exportJson, exportCsv, exportXml, exportExcel, downloadFile } from '@/services/export'

type ExportFormat = 'json' | 'csv' | 'xlsx' | 'xml' | 'sql' | 'parquet'

const FORMAT_OPTIONS: { value: ExportFormat; label: string; ext: string; mime: string }[] = [
  { value: 'json', label: 'JSON', ext: '.json', mime: 'application/json' },
  { value: 'csv', label: 'CSV', ext: '.csv', mime: 'text/csv' },
  { value: 'xlsx', label: 'Excel (XLSX)', ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { value: 'xml', label: 'XML', ext: '.xml', mime: 'application/xml' },
  { value: 'sql', label: 'SQL INSERT', ext: '.sql', mime: 'text/plain' },
  { value: 'parquet', label: 'Parquet', ext: '.parquet', mime: 'application/octet-stream' },
]

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const { getTables, deleteTable, setTables, updateTable } = useStore()
  const { t } = useLang()
  const tables = getTables(id)
  const [orderedTables, setOrderedTables] = useState(tables)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const tablesRef = useRef(tables)
  if (tables !== tablesRef.current) {
    tablesRef.current = tables
    if (orderedTables.length !== tables.length || !tables.every((t, i) => orderedTables[i]?.id === t.id)) {
      setOrderedTables(tables)
    }
  }

  // On mount or when tables change, fetch row counts from Parquet for tables
  // that show 0 rows (either no cached rowCount or genuinely empty).
  // Uses the lightweight ?count=true API to avoid loading all data.
  useEffect(() => {
    const toCheck: { id: string; name: string }[] = []
    for (const table of tables) {
      if ((table.rowCount ?? 0) > 0) continue
      if (table.columns.length === 0) continue
      toCheck.push({ id: table.id, name: table.name })
    }
    if (toCheck.length === 0) return
    Promise.allSettled(
      toCheck.map(async ({ id: tid, name: tableName }) => {
        const url = `/api/data?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(tableName)}&count=true`
        const res = await fetch(url)
        if (!res.ok) return
        const data = await res.json() as { count?: number }
        if (typeof data.count === 'number' && data.count > 0) {
          updateTable(id, tid, { rowCount: data.count })
        }
      })
    )
  }, [id, tables.length])

  const [showExport, setShowExport] = useState(false)
  const [exportFormats, setExportFormats] = useState<Record<string, ExportFormat>>({})

  const handleExportAll = async () => {
    for (const table of orderedTables) {
      const fmt = exportFormats[table.id] || 'json'
      const opt = FORMAT_OPTIONS.find(f => f.value === fmt)!
      if (fmt === 'parquet') {
        const a = document.createElement('a')
        a.href = `/api/data/download?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(table.name)}`
        a.download = `${table.name}${opt.ext}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      } else {
        // Fetch fresh data from API in case in-memory rows are stale/empty
        let tableWithRows = table
        try {
          const res = await fetch(`/api/data?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(table.name)}`)
          if (res.ok) {
            const data = await res.json() as { rows: Record<string, unknown>[] }
            if (data.rows && data.rows.length > 0) {
              tableWithRows = { ...table, rows: data.rows }
            }
          }
        } catch {}
        const exporters: Record<string, (t: typeof table) => string | Uint8Array> = {
          json: exportJson, csv: exportCsv, xml: exportXml, sql: exportSql,
        }
        const fn = exporters[fmt]
        if (fn) {
          downloadFile(fn(tableWithRows) as string, `${table.name}${opt.ext}`, opt.mime)
        } else if (fmt === 'xlsx') {
          downloadFile(exportExcel(tableWithRows), `${table.name}${opt.ext}`, opt.mime)
        }
      }
    }
    setShowExport(false)
  }

  const handleDragStart = (i: number) => setDragIdx(i)

  const handleDragOver = useCallback((e: React.DragEvent, i: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === i) return
    const reordered = [...orderedTables]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(i, 0, moved)
    setOrderedTables(reordered)
    setDragIdx(i)
    setTables(id, reordered)
  }, [dragIdx, orderedTables, id, setTables])

  const handleDragEnd = () => setDragIdx(null)

  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gv-text">
          {t('project.tables')} ({tables.length})
        </h2>
        <div className="flex items-center gap-2">
          {orderedTables.length > 0 && (
            <button
              onClick={() => {
                const defaults: Record<string, ExportFormat> = {}
                for (const t of orderedTables) defaults[t.id] = 'json'
                setExportFormats(defaults)
                setShowExport(true)
              }}
              className="btn-outline rounded-lg px-4 py-2 text-sm inline-flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {t('project.export_all')}
            </button>
          )}
          <Link
            href={`/project/${id}/table/new`}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-1"
          >
            + {t('project.new_table')}
          </Link>
        </div>
      </div>

      {/* Export All Modal */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={() => setShowExport(false)}>
          <div className="glass-raised rounded-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gv-text mb-1">{t('project.export_all_title')}</h3>
            <p className="text-sm text-gv-text-dim mb-4">{t('project.export_all_desc')}</p>
            <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
              {orderedTables.map(table => (
                <div key={table.id} className="flex items-center justify-between gap-3 py-2 border-b border-gv-border last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gv-text truncate">{table.name}</p>
                    <p className="text-xs text-gv-text-muted">{table.columns.length} {t('project.columns_count')} &middot; {(table.rowCount ?? table.rows.length)} {t('project.rows_count')}</p>
                  </div>
                  <select
                    value={exportFormats[table.id] || 'json'}
                    onChange={e => setExportFormats(prev => ({ ...prev, [table.id]: e.target.value as ExportFormat }))}
                    className="rounded-lg border border-gv-border bg-gv-bg text-gv-text px-2.5 py-1.5 text-sm focus:outline-none focus:border-gv-pink flex-shrink-0"
                  >
                    {FORMAT_OPTIONS.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowExport(false)}
                className="btn-outline rounded-lg px-4 py-2 text-sm"
              >
                {t('app.cancel')}
              </button>
              <button
                onClick={handleExportAll}
                className="btn-primary rounded-lg px-4 py-2 text-sm"
              >
                {t('project.download_all')}
              </button>
            </div>
          </div>
        </div>
      )}

      {orderedTables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gv-text-dim">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gv-pink/10 to-gv-green/10 flex items-center justify-center mb-4 border border-gv-border">
            <svg className="w-8 h-8 text-gv-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-base font-medium">{t('project.no_tables')}</p>
          <p className="text-sm mt-1">{t('project.no_tables_desc')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orderedTables.map((table, i) => (
            <div
              key={table.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragEnd={handleDragEnd}
              className={`card group p-5 flex items-center gap-4 transition-all duration-200 ${
                dragIdx === i ? 'opacity-50 border-gv-pink shadow-[0_0_16px_var(--color-gv-pink-glow)]' : ''
              }`}
            >
              <div className="cursor-grab active:cursor-grabbing text-gv-text-muted hover:text-gv-pink select-none flex-shrink-0 transition-colors" title={t('project.drag_hint')}>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <Link href={`/project/${id}/table/${table.id}`} className="block">
                  <h3 className="font-semibold text-gv-text group-hover:text-gv-pink transition-colors">
                    {table.name}
                  </h3>
                  <p className="text-sm text-gv-text-dim mt-1">
                    {table.columns.length} {t('project.columns_count')} &middot; {(table.rowCount ?? table.rows.length)} {t('project.rows_count')}
                  </p>
                </Link>
                {table.columns.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {table.columns.map(col => (
                      <span
                        key={col.id}
                        className="inline-block text-xs px-2 py-0.5 rounded-full bg-gv-bg text-gv-text-dim border border-gv-border"
                      >
                        {col.name}
                        <span className="ml-1 text-gv-text-muted">
                          {col.type === 'foreign_key' ? 'FK' : col.type}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link
                  href={`/project/${id}/table/${table.id}`}
                  className="rounded-lg px-3 py-1.5 text-sm bg-gv-pink/10 text-gv-pink hover:bg-gv-pink/20 transition-colors font-medium"
                >
                  {t('project.edit_btn')}
                </Link>
                <button
                  onClick={() => {
                    if (confirm(`${t('project.delete_confirm')} "${table.name}"?`)) {
                      deleteTable(id, table.id)
                    }
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm text-gv-pink-dark hover:bg-gv-pink/10 transition-colors"
                >
                  {t('project.delete_btn')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
