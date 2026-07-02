'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { Project, TableDef } from './types'

interface StoreState {
  projects: Project[]
  tables: Record<string, TableDef[]>
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
}

const STORAGE_KEY = 'nuwa-store'

function loadFromStorage(): StoreState {
  if (typeof window === 'undefined') {
    return { projects: [], tables: {} }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return JSON.parse(raw)
    }
  } catch {
    // ignore parse errors
  }
  return { projects: [], tables: {} }
}

function saveToStorage(state: StoreState) {
  if (typeof window === 'undefined') return
  try {
    // Strip rows from tables before saving — rows are persisted via API/Parquet
    const stripped: StoreState = {
      projects: state.projects,
      tables: {},
    }
    for (const [projectId, tableList] of Object.entries(state.tables)) {
      stripped.tables[projectId] = tableList.map(t => ({ ...t, rows: [] }))
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped))
  } catch {
    // localStorage full or unavailable — alert user once per session
    if (typeof window !== 'undefined' && !(window as any).__nuwa_storage_warned) {
      (window as any).__nuwa_storage_warned = true
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
  const [state, setState] = useState<StoreState>({ projects: [], tables: {} })

  // Hydrate from localStorage on mount
  useEffect(() => {
    setState(loadFromStorage())
  }, [])

  // Persist on change
  useEffect(() => {
    saveToStorage(state)
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
    }))
    return project
  }, [])

  const deleteProject = useCallback((id: string) => {
    // Fire-and-forget: delete Parquet files from disk
    fetch(`/api/data?projectId=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    setState(prev => {
      const { [id]: _, ...rest } = prev.tables
      return {
        projects: prev.projects.filter(p => p.id !== id),
        tables: rest,
      }
    })
  }, [])

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setState(prev => ({
      ...prev,
      projects: prev.projects.map(p => (p.id === id ? { ...p, ...updates } : p)),
    }))
  }, [])

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
      // Look up the table name for Parquet file deletion
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
