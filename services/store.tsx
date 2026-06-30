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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
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
    setState(prev => ({
      ...prev,
      tables: {
        ...prev.tables,
        [projectId]: (prev.tables[projectId] || []).filter(t => t.id !== tableId),
      },
    }))
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
