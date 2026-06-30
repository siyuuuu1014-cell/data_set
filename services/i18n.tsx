'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

export type Lang = 'zh' | 'en'

const MESSAGES: Record<Lang, Record<string, string>> = {
  zh: {
    'app.title': '女娲智能合成数据平台',
    'app.brand': '女娲',
    'app.subtitle': '智能合成数据平台',
    'app.home': '首页',
    'app.settings': '设置',
    'app.configured': '已配置',
    'app.unconfigured': '未配置',
    'app.back': '返回',
    'app.save': '保存',
    'app.cancel': '取消',
    'app.delete': '删除',
    'app.edit': '编辑',
    'app.create': '创建',
    'app.export': '导出',
    'app.download': '下载',
    'app.test': '测试',
    'app.loading': '加载中...',
    'app.confirm': '确定',
    'app.search': '搜索',
    'app.none': '无',

    'home.title': '项目列表',
    'home.new_project': '新建项目',
    'home.no_projects': '还没有项目',
    'home.no_projects_desc': '创建第一个项目，开始合成数据之旅',
    'home.settings_hint': '前往设置',

    'project.new_title': '新建项目',
    'project.name_placeholder': '输入项目名称...',
    'project.create_btn': '创建项目',
    'project.name_required': '请输入项目名称',

    'project.tables': '数据表',
    'project.new_table': '新建数据表',
    'project.no_tables': '还没有数据表',
    'project.no_tables_desc': '创建数据表并定义列结构，然后生成合成数据',
    'project.export_all': '导出全部',
    'project.export_all_title': '导出全部数据表',
    'project.export_all_desc': '为每个表选择导出格式',
    'project.download_all': '下载全部',
    'project.edit_btn': '编辑',
    'project.delete_btn': '删除',
    'project.delete_confirm': '确定要删除数据表',
    'project.columns_count': '列',
    'project.rows_count': '行数据',
    'project.drag_hint': '拖动排序',

    'table.new_title': '新建数据表',
    'table.name': '表名',
    'table.name_placeholder': '例如：users, orders...',
    'table.related_tables': '关联表（可选）',
    'table.related_hint': '选择已有表，勾选字段即可导入为外键列',
    'table.random_select': '随机选择',
    'table.col_def': '列定义',
    'table.add_col': '添加列',
    'table.create_btn': '创建数据表',
    'table.col_name': '列名',
    'table.col_name_required': '请填写所有列名',
    'table.text_prompt_required': '文本列的提示词不能为空',
    'table.fk_table_required': '外键列需要选择引用的表',
    'table.name_required': '请输入表名',

    'table.generate': '生成数据',
    'table.generating': '生成中...',
    'table.row_count': '行数',
    'table.rows': '行',
    'table.no_data': '暂无数据，点击生成',
    'table.stats': '数据概况',
    'table.edit_schema': '编辑结构',
    'table.save_changes': '保存',
    'table.discard_changes': '取消',
    'table.export_menu': '导出',
    'table.showing_rows': '显示前 {0} 行，共 {1} 行',

    'settings.title': 'LLM API 配置',
    'settings.api_key': 'API Key',
    'settings.api_key_saved': '已保存，留空则不修改',
    'settings.base_url': 'Base URL',
    'settings.model': '模型',
    'settings.test_btn': '测试连接',
    'settings.save_btn': '保存配置',
    'settings.saved': '已保存',
    'settings.test_success': '连接成功',
    'settings.test_fail': '连接失败',

    'lang.switch': 'EN',
  },
  en: {
    'app.title': 'Nuwa Synthetic Data Platform',
    'app.brand': 'Nuwa',
    'app.subtitle': 'Synthetic Data Platform',
    'app.home': 'Home',
    'app.settings': 'Settings',
    'app.configured': 'Configured',
    'app.unconfigured': 'Not configured',
    'app.back': 'Back',
    'app.save': 'Save',
    'app.cancel': 'Cancel',
    'app.delete': 'Delete',
    'app.edit': 'Edit',
    'app.create': 'Create',
    'app.export': 'Export',
    'app.download': 'Download',
    'app.test': 'Test',
    'app.loading': 'Loading...',
    'app.confirm': 'Confirm',
    'app.search': 'Search',
    'app.none': 'None',

    'home.title': 'Projects',
    'home.new_project': 'New Project',
    'home.no_projects': 'No projects yet',
    'home.no_projects_desc': 'Create your first project to start synthesizing data',
    'home.settings_hint': 'Configure',

    'project.new_title': 'New Project',
    'project.name_placeholder': 'Enter project name...',
    'project.create_btn': 'Create Project',
    'project.name_required': 'Project name is required',

    'project.tables': 'Data Tables',
    'project.new_table': 'New Table',
    'project.no_tables': 'No tables yet',
    'project.no_tables_desc': 'Create a table with column definitions, then generate synthetic data',
    'project.export_all': 'Export All',
    'project.export_all_title': 'Export All Tables',
    'project.export_all_desc': 'Select export format for each table',
    'project.download_all': 'Download All',
    'project.edit_btn': 'Edit',
    'project.delete_btn': 'Delete',
    'project.delete_confirm': 'Delete table',
    'project.columns_count': 'cols',
    'project.rows_count': 'rows',
    'project.drag_hint': 'Drag to reorder',

    'table.new_title': 'New Table',
    'table.name': 'Table Name',
    'table.name_placeholder': 'e.g. users, orders...',
    'table.related_tables': 'Related Tables (optional)',
    'table.related_hint': 'Select existing tables and check columns to import',
    'table.random_select': 'Random Select',
    'table.col_def': 'Column Definitions',
    'table.add_col': 'Add Column',
    'table.create_btn': 'Create Table',
    'table.col_name': 'Column Name',
    'table.col_name_required': 'All columns need a name',
    'table.text_prompt_required': 'Text columns need a prompt',
    'table.fk_table_required': 'Foreign key columns need a referenced table',
    'table.name_required': 'Table name is required',

    'table.generate': 'Generate Data',
    'table.generating': 'Generating...',
    'table.row_count': 'Row count',
    'table.rows': 'rows',
    'table.no_data': 'No data yet. Click generate.',
    'table.stats': 'Statistics',
    'table.edit_schema': 'Edit Schema',
    'table.save_changes': 'Save',
    'table.discard_changes': 'Cancel',
    'table.export_menu': 'Export',
    'table.showing_rows': 'Showing first {0} of {1} rows',

    'settings.title': 'LLM API Configuration',
    'settings.api_key': 'API Key',
    'settings.api_key_saved': 'Saved — leave blank to keep unchanged',
    'settings.base_url': 'Base URL',
    'settings.model': 'Model',
    'settings.test_btn': 'Test Connection',
    'settings.save_btn': 'Save Config',
    'settings.saved': 'Saved',
    'settings.test_success': 'Connection successful',
    'settings.test_fail': 'Connection failed',

    'lang.switch': '中文',
  },
}

interface LangContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, ...args: (string | number)[]) => string
}

const LangContext = createContext<LangContextValue | null>(null)

const STORAGE_KEY = 'nuwa-lang'

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'en' || stored === 'zh') setLangState(stored)
    }
  }, [])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, l)
  }, [])

  const t = useCallback((key: string, ...args: (string | number)[]): string => {
    const msg = MESSAGES[lang][key] || MESSAGES.zh[key] || key
    return (args as (string | number)[]).reduce((s: string, arg, i) => s.replace(`{${i}}`, String(arg)), msg) as string
  }, [lang])

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within LangProvider')
  return ctx
}
