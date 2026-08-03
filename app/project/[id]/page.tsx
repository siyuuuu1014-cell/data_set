'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button, EmptyState, PageHeader, PageShell, StatusBadge, useConfirm } from '@/components/ui'
import { downloadFile, exportCsv, exportExcel, exportJson, exportSql, exportXml } from '@/services/export'
import { useLang } from '@/services/i18n'
import { useStore } from '@/services/store'
import type { TableDef } from '@/services/types'
import styles from '../project-management.module.css'

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
  const confirmAction = useConfirm()
  const tables = getTables(id)
  const orderedTables = tables
  const totalColumns = tables.reduce((sum, table) => sum + table.columns.length, 0)
  const totalRows = tables.reduce((sum, table) => sum + (table.rowCount ?? table.rows.length), 0)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [exportTargetId, setExportTargetId] = useState<string | null>(null)
  const [exportFormats, setExportFormats] = useState<Record<string, ExportFormat>>({})
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [tableSearch, setTableSearch] = useState('')

  const normalizedTableSearch = tableSearch.trim().toLocaleLowerCase()
  const visibleTables = normalizedTableSearch
    ? orderedTables.filter(table => {
        const searchable = [
          table.name,
          ...table.columns.flatMap(column => [column.name, column.type]),
        ].join(' ').toLocaleLowerCase()
        return searchable.includes(normalizedTableSearch)
      })
    : orderedTables

  const exportTables = exportTargetId
    ? orderedTables.filter(table => table.id === exportTargetId)
    : orderedTables

  useEffect(() => {
    const toCheck = tables.filter(table => (table.rowCount ?? 0) === 0 && table.columns.length > 0)
    if (toCheck.length === 0) return

    void Promise.allSettled(toCheck.map(async table => {
      const url = `/api/data?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(table.name)}&count=true`
      const response = await fetch(url)
      if (!response.ok) return
      const data = await response.json() as { count?: number }
      if (typeof data.count === 'number' && data.count > 0) {
        updateTable(id, table.id, { rowCount: data.count })
      }
    }))
  }, [id, tables, updateTable])

  const openExport = (tableId: string | null = null) => {
    const targets = tableId ? orderedTables.filter(table => table.id === tableId) : orderedTables
    setExportFormats(Object.fromEntries(targets.map(table => [table.id, 'json' as ExportFormat])))
    setExportTargetId(tableId)
    setExportError('')
    setShowExport(true)
  }

  const exportTable = async (table: TableDef, format: ExportFormat) => {
    const option = FORMAT_OPTIONS.find(item => item.value === format)
    if (!option) return

    if (format === 'parquet') {
      const link = document.createElement('a')
      link.href = `/api/data/download?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(table.name)}`
      link.download = `${table.name}${option.ext}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      return
    }

    const response = await fetch(`/api/data?projectId=${encodeURIComponent(id)}&tableName=${encodeURIComponent(table.name)}`)
    if (!response.ok) throw new Error(`Data request failed with status ${response.status}`)
    const data = await response.json() as { rows?: Record<string, unknown>[] }
    const tableWithRows = Array.isArray(data.rows) ? { ...table, rows: data.rows } : table

    const exporters: Partial<Record<ExportFormat, (value: TableDef) => string | Uint8Array>> = {
      json: exportJson,
      csv: exportCsv,
      xml: exportXml,
      sql: exportSql,
      xlsx: exportExcel,
    }
    const exporter = exporters[format]
    if (!exporter) return
    downloadFile(exporter(tableWithRows), `${table.name}${option.ext}`, option.mime)
  }

  const handleExport = async () => {
    if (exporting || exportTables.length === 0) return
    setExporting(true)
    setExportError('')
    try {
      for (const table of exportTables) {
        await exportTable(table, exportFormats[table.id] || 'json')
      }
      setShowExport(false)
    } catch {
      setExportError(t('project.export_error'))
    } finally {
      setExporting(false)
    }
  }

  const moveTable = (index: number, direction: -1 | 1) => {
    const destination = index + direction
    if (destination < 0 || destination >= orderedTables.length) return
    const reordered = [...orderedTables]
    ;[reordered[index], reordered[destination]] = [reordered[destination], reordered[index]]
    setTables(id, reordered)
  }

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault()
    if (dragIdx === null || dragIdx === index) return
    const reordered = [...orderedTables]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(index, 0, moved)
    setDragIdx(index)
    setTables(id, reordered)
  }

  return (
    <PageShell width="wide" className={styles.projectDetailPage}>
      <PageHeader
        className={styles.detailHeader}
        title={`${t('project.tables')} (${tables.length})`}
        description={t('project.tables_desc')}
        actions={(
          <div className={styles.pageActions}>
            {orderedTables.length > 0 && (
              <Button className={styles.exportAllButton} variant="secondary" onClick={() => openExport()}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t('project.export_all')}
              </Button>
            )}
            <Link href={`/project/${id}/table/new`} className={styles.primaryLink}>
              <span aria-hidden="true">+</span>
              {t('project.new_table')}
            </Link>
          </div>
        )}
      />

      <dl className={styles.summaryStrip} aria-label={t('project.project_summary')}>
        <div><dt>{t('project.metric_tables')}</dt><dd>{tables.length}</dd></div>
        <div><dt>{t('project.metric_columns')}</dt><dd>{totalColumns}</dd></div>
        <div><dt>{t('project.metric_rows')}</dt><dd>{totalRows.toLocaleString()}</dd></div>
      </dl>

      {orderedTables.length > 0 && (
        <section className={styles.tableSearchBar} aria-label={t('project.table_search_label')}>
          <div className={styles.tableSearchField}>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
            </svg>
            <label htmlFor="project-table-search" className="sr-only">{t('project.table_search_label')}</label>
            <input
              id="project-table-search"
              type="search"
              value={tableSearch}
              onChange={event => setTableSearch(event.target.value)}
              placeholder={t('project.table_search_placeholder')}
            />
            {tableSearch && (
              <button type="button" onClick={() => setTableSearch('')} aria-label={t('project.clear_table_search')}>
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <p aria-live="polite">
            {normalizedTableSearch
              ? t('project.table_search_count', visibleTables.length, orderedTables.length)
              : t('project.table_search_hint')}
          </p>
        </section>
      )}

      {showExport && (
        <div className={styles.modalOverlay} onClick={() => !exporting && setShowExport(false)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            aria-describedby="export-description"
            onClick={event => event.stopPropagation()}
          >
            <h2 id="export-title">
              {exportTargetId ? t('project.export_table_title', exportTables[0]?.name || '') : t('project.export_all_title')}
            </h2>
            <p id="export-description" className={styles.modalDescription}>{t('project.export_all_desc')}</p>
            {exportError && <p className={styles.modalError} role="alert">{exportError}</p>}
            <div className={styles.exportList}>
              {exportTables.map(table => (
                <div key={table.id} className={styles.exportRow}>
                  <div className={styles.exportCopy}>
                    <strong>{table.name}</strong>
                    <span>
                      {table.columns.length} {t('project.columns_count')} &middot;{' '}
                      {(table.rowCount ?? table.rows.length).toLocaleString()} {t('project.rows_count')}
                    </span>
                  </div>
                  <select
                    value={exportFormats[table.id] || 'json'}
                    onChange={event => setExportFormats(previous => ({ ...previous, [table.id]: event.target.value as ExportFormat }))}
                    className={styles.formatSelect}
                    aria-label={`${table.name} ${t('project.export_format')}`}
                    disabled={exporting}
                  >
                    {FORMAT_OPTIONS.map(format => (
                      <option key={format.value} value={format.value}>{format.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className={styles.modalActions}>
              <Button variant="secondary" onClick={() => setShowExport(false)} disabled={exporting}>{t('app.cancel')}</Button>
              <Button onClick={handleExport} loading={exporting}>
                {exportTargetId ? t('project.download_table') : t('project.download_all')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {orderedTables.length === 0 ? (
        <section className={styles.tableEmpty}>
          <EmptyState
            title={t('project.no_tables')}
            description={t('project.no_tables_desc')}
            icon={(
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
            action={<Link href={`/project/${id}/table/new`} className={styles.primaryLink}>{t('project.new_table')}</Link>}
          />
        </section>
      ) : visibleTables.length === 0 ? (
        <section className={styles.tableSearchEmpty}>
          <EmptyState
            title={t('project.no_table_results')}
            description={t('project.no_table_results_help')}
            action={<Button variant="secondary" onClick={() => setTableSearch('')}>{t('project.clear_table_search')}</Button>}
          />
        </section>
      ) : (
        <section className={styles.tableList} aria-label={t('project.tables')}>
          {visibleTables.map(table => {
            const index = orderedTables.findIndex(item => item.id === table.id)
            return (
            <div
              key={table.id}
              draggable={!normalizedTableSearch}
              onDragStart={() => setDragIdx(index)}
              onDragOver={event => handleDragOver(event, index)}
              onDragEnd={() => setDragIdx(null)}
              className={`${styles.tableRow} ${dragIdx === index ? styles.tableRowDragging : ''} ${normalizedTableSearch ? styles.tableRowFiltered : ''}`}
            >
              <div className={styles.reorderTools}>
                <span className={styles.dragHandle} title={t('project.drag_hint')} aria-hidden="true">
                  <svg fill="currentColor" viewBox="0 0 20 20">
                    <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                  </svg>
                </span>
                <span className={styles.keyboardReorder}>
                  <button type="button" onClick={() => moveTable(index, -1)} disabled={Boolean(normalizedTableSearch) || index === 0} aria-label={t('project.move_up', table.name)}>&uarr;</button>
                  <button type="button" onClick={() => moveTable(index, 1)} disabled={Boolean(normalizedTableSearch) || index === orderedTables.length - 1} aria-label={t('project.move_down', table.name)}>&darr;</button>
                </span>
              </div>
              <div className={styles.tableBody}>
                <Link href={`/project/${id}/table/${table.id}`} className={styles.tableMainLink}>
                  <h3>{table.name}</h3>
                  <p>
                    {table.columns.length} {t('project.columns_count')} &middot;{' '}
                    {(table.rowCount ?? table.rows.length).toLocaleString()} {t('project.rows_count')}
                  </p>
                </Link>
                {table.columns.length > 0 && (
                  <div className={styles.columnList}>
                    {table.columns.slice(0, 6).map(column => (
                      <StatusBadge key={column.id} tone="neutral" dot={false}>
                        {column.name} &middot; {column.type === 'foreign_key' ? 'FK' : column.type}
                      </StatusBadge>
                    ))}
                    {table.columns.length > 6 && <StatusBadge tone="neutral" dot={false}>+{table.columns.length - 6}</StatusBadge>}
                  </div>
                )}
              </div>
              <div className={styles.rowActions}>
                <Button variant="quiet" size="sm" onClick={() => openExport(table.id)}>{t('project.export_table')}</Button>
                <Link href={`/project/${id}/table/${table.id}`} className={styles.editLink}>{t('project.edit_btn')}</Link>
                <Button
                  variant="quiet"
                  size="sm"
                  className={styles.deleteButton}
                  onClick={async () => {
                    if (await confirmAction({ message: `${t('project.delete_confirm')} "${table.name}"?`, confirmLabel: t('app.delete'), tone: 'danger' })) deleteTable(id, table.id)
                  }}
                >
                  {t('project.delete_btn')}
                </Button>
              </div>
            </div>
            )
          })}
        </section>
      )}
    </PageShell>
  )
}
