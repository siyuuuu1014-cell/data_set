'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { Project, TableDef } from './types'
import type { AnnotateSet } from './video-annotation/types'

interface StoreState {
  projects: Project[]
  tables: Record<string, TableDef[]>
  annotateSets: Record<string, AnnotateSet[]>  // projectId → sets
}

interface StoreContextValue extends StoreState {
  addProject: (name: string) => Project
  deleteProject: (id: string) => void
  updateProject: (id: string, updates: Partial<Project>) => void
  getTables: (projectId: string) => TableDef[]
  addTable: (projectId: string, table: TableDef) => void
  updateTable: (projectId: string, tableId: string, updates: Partial<TableDef>) => void
  deleteTable: (projectId: string, tableId: string) => void
  setTableRows: (projectId: string, tableId: string, rows: Record<string, unknown>[]) => void
  setTables: (projectId: string, tables: TableDef[]) => void

  // ── Annotate sets ──────────────────────────────────────
  getAnnotateSets: (projectId: string) => AnnotateSet[]
  addAnnotateSet: (projectId: string, set: AnnotateSet) => void
  updateAnnotateSet: (projectId: string, setId: string, updates: Partial<AnnotateSet>) => void
  deleteAnnotateSet: (projectId: string, setId: string) => void
  setAnnotateSets: (projectId: string, sets: AnnotateSet[]) => void
}

const STORAGE_KEY = 'nuwa-store'

const INITIAL_STATE: StoreState = { projects: [], tables: {}, annotateSets: {} }

function loadFromStorage(): StoreState {
  if (typeof window === 'undefined') {
    return INITIAL_STATE
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        projects: parsed.projects || [],
        tables: parsed.tables || {},
        annotateSets: parsed.annotateSets || {},
      }
    }
  } catch {
    // ignore parse errors
  }
  return INITIAL_STATE
}

function saveToStorage(state: StoreState) {
  if (typeof window === 'undefined') return
  try {
    // Strip large payloads before saving to localStorage
    const stripped: StoreState = {
      projects: state.projects,
      tables: {},
      annotateSets: {},
    }
    for (const [projectId, tableList] of Object.entries(state.tables)) {
      stripped.tables[projectId] = tableList.map(t => ({ ...t, rows: [], rowCount: t.rows.length || t.rowCount || 0 }))
    }
    for (const [projectId, sets] of Object.entries(state.annotateSets)) {
      stripped.annotateSets[projectId] = sets.map(s => ({
        ...s,
        videos: s.videos.map(v => ({ ...v, segments: [], uploadProgress: 0 })),
      }))
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped))
  } catch {
    if (typeof window !== 'undefined' && !(window as Window & { __nuwa_storage_warned?: boolean }).__nuwa_storage_warned) {
      (window as Window & { __nuwa_storage_warned?: boolean }).__nuwa_storage_warned = true
      alert('存储空间不足，数据可能无法保存。请导出数据后清理旧项目。')
    }
  }
}

const StoreContext = createContext<StoreContextValue | null>(null)

let _idCounter = Date.now()
function genId(): string {
  return (_idCounter++).toString(36)
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreState>(INITIAL_STATE)
  const hydratedRef = React.useRef(false)

  // Hydrate from localStorage on mount — one-time, intentional
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setState(loadFromStorage())
    hydratedRef.current = true
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist on change — skip when store is empty (prevents accidental wipe)
  useEffect(() => {
    if (hydratedRef.current && (state.projects.length > 0 || Object.keys(state.tables).length > 0 || Object.keys(state.annotateSets).length > 0)) {
      saveToStorage(state)
    }
  }, [state])

  const addProject = useCallback((name: string): Project => {
    const project: Project = {
      id: genId(),
      name,
      createdAt: new Date().toISOString(),
    }
    setState(prev => ({
      projects: [...prev.projects, project],
      tables: { ...prev.tables, [project.id]: [] },
      annotateSets: { ...prev.annotateSets, [project.id]: [] },
    }))
    return project
  }, [])

  const deleteProject = useCallback((id: string) => {
    fetch(`/api/data?projectId=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    setState(prev => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _t, ...restTables } = prev.tables
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _a, ...restAnnotate } = prev.annotateSets
      return {
        projects: prev.projects.filter(p => p.id !== id),
        tables: restTables,
        annotateSets: restAnnotate,
      }
    })
  }, [])

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setState(prev => ({
      ...prev,
      projects: prev.projects.map(p => (p.id === id ? { ...p, ...updates } : p)),
    }))
  }, [])

  // ── Tables ─────────────────────────────────────────────

  const getTables = useCallback((projectId: string): TableDef[] => {
    return state.tables[projectId] || []
  }, [state.tables])

  const addTable = useCallback((projectId: string, table: TableDef) => {
    setState(prev => ({
      ...prev,
      tables: {
        ...prev.tables,
        [projectId]: [...(prev.tables[projectId] || []), table],
      },
    }))
  }, [])

  const updateTable = useCallback((projectId: string, tableId: string, updates: Partial<TableDef>) => {
    setState(prev => ({
      ...prev,
      tables: {
        ...prev.tables,
        [projectId]: (prev.tables[projectId] || []).map(t =>
          t.id === tableId ? { ...t, ...updates } : t
        ),
      },
    }))
  }, [])

  const setTables = useCallback((projectId: string, tables: TableDef[]) => {
    setState(prev => ({
      ...prev,
      tables: { ...prev.tables, [projectId]: tables },
    }))
  }, [])

  const deleteTable = useCallback((projectId: string, tableId: string) => {
    setState(prev => {
      const tables = prev.tables[projectId] || []
      const table = tables.find(t => t.id === tableId)
      if (table) {
        fetch(`/api/data?projectId=${encodeURIComponent(projectId)}&tableName=${encodeURIComponent(table.name)}`, { method: 'DELETE' }).catch(() => {})
      }
      return {
        ...prev,
        tables: {
          ...prev.tables,
          [projectId]: tables.filter(t => t.id !== tableId),
        },
      }
    })
  }, [])

  const setTableRows = useCallback((projectId: string, tableId: string, rows: Record<string, unknown>[]) => {
    setState(prev => ({
      ...prev,
      tables: {
        ...prev.tables,
        [projectId]: (prev.tables[projectId] || []).map(t =>
          t.id === tableId ? { ...t, rows } : t
        ),
      },
    }))
  }, [])

  // ── Annotate sets ──────────────────────────────────────

  const getAnnotateSets = useCallback((projectId: string): AnnotateSet[] => {
    return state.annotateSets[projectId] || []
  }, [state.annotateSets])

  const addAnnotateSet = useCallback((projectId: string, set: AnnotateSet) => {
    setState(prev => ({
      ...prev,
      annotateSets: {
        ...prev.annotateSets,
        [projectId]: [...(prev.annotateSets[projectId] || []), set],
      },
    }))
  }, [])

  const updateAnnotateSet = useCallback((projectId: string, setId: string, updates: Partial<AnnotateSet>) => {
    setState(prev => ({
      ...prev,
      annotateSets: {
        ...prev.annotateSets,
        [projectId]: (prev.annotateSets[projectId] || []).map(s =>
          s.id === setId ? { ...s, ...updates } : s
        ),
      },
    }))
  }, [])

  const deleteAnnotateSet = useCallback((projectId: string, setId: string) => {
    setState(prev => ({
      ...prev,
      annotateSets: {
        ...prev.annotateSets,
        [projectId]: (prev.annotateSets[projectId] || []).filter(s => s.id !== setId),
      },
    }))
  }, [])

  const setAnnotateSets = useCallback((projectId: string, sets: AnnotateSet[]) => {
    setState(prev => ({
      ...prev,
      annotateSets: { ...prev.annotateSets, [projectId]: sets },
    }))
  }, [])

  return (
    <StoreContext.Provider
      value={{
        ...state,
        addProject,
        deleteProject,
        updateProject,
        getTables,
        addTable,
        updateTable,
        deleteTable,
        setTableRows,
        setTables,
        getAnnotateSets,
        addAnnotateSet,
        updateAnnotateSet,
        deleteAnnotateSet,
        setAnnotateSets,
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) {
    throw new Error('useStore must be used within StoreProvider')
  }
  return ctx
}
