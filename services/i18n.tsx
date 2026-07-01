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
    'app.testing': '测试中...',
    'app.loading': '加载中...',
    'app.confirm': '确定',
    'app.search': '搜索',
    'app.none': '无',
    'app.projects_count': '{0} 个项目',

    'home.title': '项目列表',
    'home.new_project': '新建项目',
    'home.no_projects': '还没有项目',
    'home.no_projects_desc': '创建第一个项目，开始合成数据之旅',
    'home.settings_hint': '前往设置',

    'project.new_title': '新建项目',
    'project.name_placeholder': '输入项目名称...',
    'project.create_btn': '创建项目',
    'project.name_required': '请输入项目名称',
    'project.not_found': '项目不存在',

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

    // ---- Column types ----
    'coltype.text': '文本 (LLM)',
    'coltype.text_short': '文本',
    'coltype.text_create': '文本 (LLM生成)',
    'coltype.number': '数字 (代码)',
    'coltype.number_short': '数字',
    'coltype.number_create': '数字 (代码生成)',
    'coltype.boolean': '布尔值',
    'coltype.boolean_short': '布尔',
    'coltype.date': '日期',
    'coltype.date_short': '日期',
    'coltype.id': 'ID (自增/雪花)',
    'coltype.id_short': 'ID',
    'coltype.phone': '电话',
    'coltype.phone_short': '电话',
    'coltype.city': '城市',
    'coltype.city_short': '城市',
    'coltype.foreign_key': '外键',
    'coltype.foreign_key_create': '外键 (引用其他表)',
    'coltype.foreign_key_array': '外键数组',

    // ---- Countries ----
    'country.CN': '中国 (+86)',
    'country.US': '美国 (+1)',
    'country.JP': '日本 (+81)',
    'country.KR': '韩国 (+82)',
    'country.GB': '英国 (+44)',
    'country.DE': '德国 (+49)',
    'country.FR': '法国 (+33)',
    'country.IN': '印度 (+91)',
    'country.BR': '巴西 (+55)',
    'country.AU': '澳大利亚 (+61)',
    'country.CN_short': '中国',

    // ---- ID formats ----
    'idfmt.uuid4': 'UUID v4',
    'idfmt.uuid7': 'UUID v7',
    'idfmt.snowflake': '雪花ID (Snowflake)',
    'idfmt.auto_increment': '自增 (1,2,3...)',
    'idfmt.cuid2': 'CUID2',
    'idfmt.objectid': 'MongoDB ObjectID',
    'idfmt.nanoid': 'Nano ID',
    'idfmt.ulid': 'ULID',

    // ---- Date formats ----
    'datefmt.date': 'yyyy-MM-dd',
    'datefmt.datetime': 'yyyy-MM-dd HH:mm:ss',
    'datefmt.iso': 'ISO 8601',
    'datefmt.date_slash': 'yyyy/MM/dd',
    'datefmt.date_us': 'MM/dd/yyyy',
    'datefmt.date_eu': 'dd-MM-yyyy',
    'datefmt.time': 'HH:mm:ss',
    'datefmt.unix_s': 'Unix 时间戳 (秒)',
    'datefmt.unix_ms': 'Unix 时间戳 (毫秒)',

    // ---- Date ranges ----
    'daterange.7d': '近7日',
    'daterange.15d': '近15日',
    'daterange.30d': '近30日',
    'daterange.90d': '近3个月',
    'daterange.180d': '近6个月',
    'daterange.1y': '近1年',
    'daterange.3y': '近3年',

    // ---- Table editor ----
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
    'table.not_found': '数据表不存在',
    'table.back_to_project': '返回项目',

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
    'table.create_empty': '创建空记录',
    'table.import_nuwa': '导入 .nuwa',
    'table.export_nuwa': '导出 .nuwa',
    'table.no_llm': '未配置LLM',
    'table.columns': '列结构',
    'table.columns_generated': '(已生成 {0}/{1} 列)',
    'table.nullable': '允许空值',
    'table.prompt_empty': '提示词为空',
    'table.fk_missing_warn': '部分外键引用的表尚不存在。',
    'table.prompt_empty_warn': '{0} 的提示词为空，无法生成。',
    'table.fk_ref': '{0} 的提示词为空，无法生成。请点击编辑结构补充。',
    'table.drag_hint': '拖动排序',
    'table.insert_col': '+ 插入列',
    'table.insert_col_hint': '在此处插入新列',

    // Edit mode form
    'table.text_prompt_placeholder': '描述如何生成此列文本...',
    'table.number_prompt_placeholder': '描述你要的数字规则，如：中国随机纬度',
    'table.date_prompt_placeholder': '描述日期规则，如：最近30天随机日期',
    'table.ai_gen_code': 'AI 生成代码',
    'table.code_placeholder': 'JavaScript 代码，返回值作为列值。可手写或点上方 AI 生成。',
    'table.code_placeholder_short': 'JavaScript 代码，可手写或点上方 AI 生成',
    'table.test_code': '测试代码（预览5条）',
    'table.test_result': '测试结果（5条）:',
    'table.code_error': '代码错误:',
    'table.gen_fail': '生成失败',
    'table.select_ref_table': '选择引用表...',
    'table.auto_match_col': '自动匹配列',
    'table.date_distribution': '时间分布比例（%）',
    'table.bool_placeholder': '可选，留空随机 true/false',
    'table.allow_null': '允许空值 (null)',
    'table.null_ratio': '比例',
    'table.gen_col_hint': '生成 {0} 列数据',

    // Pagination
    'table.per_page': '每页',
    'table.page_info': '行 · 共 {0} 行',

    // Import/Export errors
    'table.import_fail': '导入失败',
    'table.gen_fail_short': '生成失败',
    'table.image_too_large': '图片大小不能超过 10MB',
    'table.image_fail': '图片识别失败',
    'table.image_no_columns': '未能从图片中识别出有效的列结构。请确保图片包含表格信息。',
    'table.image_read_fail': '图片读取失败',
    'table.image_load_fail': '图片加载失败',
    'table.invalid_nuwa': '无效的 .nuwa 文件格式',
    'table.save_data_fail': '保存数据失败',

    // FK errors
    'table.fk_table_missing': '引用的表"{0}"不存在',
    'table.fk_no_data': '引用的表"{0}"还没有数据，请先生成该表的数据',
    'table.fk_foreign_key': '外键',

    // Stats
    'stats.title': '数据概况',
    'stats.close': '关闭数据概况',
    'stats.count': '数量',
    'stats.mean': '均值',
    'stats.median': '中位数',
    'stats.std': '标准差',
    'stats.min_max': '最小 / 最大',
    'stats.q1_q3': 'Q1 / Q3',
    'stats.distribution': '分布',
    'stats.avg_len': '平均长度',
    'stats.chars': '字符',
    'stats.min_max_len': '最短 / 最长',
    'stats.unique': '唯一值',
    'stats.top_words': '高频词',
    'stats.city_mentions': '城市提及',
    'stats.earliest': '最早',
    'stats.latest': '最晚',
    'stats.span': '跨度',
    'stats.days': '天',
    'stats.by_month': '按月分布',
    'stats.true_ratio': 'True 占比',
    'stats.duplicates': '重复',
    'stats.unique_rate': '唯一率',
    'stats.distinct': '去重后',
    'stats.nulls': '空值',
    'stats.top_values': '高频值',
    'stats.by_province': '按省分布',
    'stats.total_rows': '共 {0} 条数据',

    // Settings
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
    'settings.description': 'API Key 存储在服务端，不会暴露给浏览器。所有项目共用此配置。',
    'settings.select_provider': '选择服务商',
    'settings.api_format': 'API 格式',
    'settings.format_openai': 'OpenAI 兼容',
    'settings.format_anthropic': 'Anthropic 兼容',
    'settings.key_saved_hint': '已存储 API Key，填写新值将覆盖',
    'settings.key_not_saved_hint': 'API Key 仅存储在服务端',
    'settings.request_url': '请求地址:',
    'settings.request_fail': '请求失败',
    'settings.network_fail': '网络请求失败',

    // API errors
    'api.not_configured': 'LLM 未配置，请先在设置页配置 API',
    'api.vision_not_supported': '图片识别仅支持多模态模型的 API 格式 (DeepSeek, GPT-4V 等)',
    'api.missing_prompt': '缺少提示词',
    'api.unknown_error': '未知错误',
    'api.cannot_connect': '无法连接到',
    'api.check_url': '请检查 Base URL 和 API 格式是否正确',
    'api.endpoint_not_found': '端点不存在',
    'api.current_format': '当前 API 格式',
    'api.auth_fail': '认证失败',
    'api.check_key': '请检查 API Key 是否正确',
    'api.api_error': 'API 错误',
    'api.no_response': '(无响应内容)',
    'api.request_url_label': '请求地址',
    'api.save_fail': '保存失败',

    // Image recognition
    'image.recognizing': '识别中...',
    'image.recognize_btn': '图片识列',

    // FK mode
    'fk.mode_fk': '外键模式 (点击切换)',
    'fk.mode_direct': '直接值模式 (点击切换)',

    // Table create form labels
    'table.fk_ref_table': '引用表',
    'table.fk_select_table': '选择表...',
    'table.fk_ref_col': '引用列 (可选)',
    'table.fk_auto_match': '自动匹配',
    'table.id_format': 'ID 格式',
    'table.country': '国家',
    'table.code_label': '生成代码 (可选，返回值转布尔)',
    'table.llm_configured_banner': 'LLM 已配置，文本列将调用模型生成。',
    'table.prompt_label': '生成提示词 (描述LLM应如何生成此列的数据)',
    'table.prompt_example': '例如：生成一个中文姓名，包含姓和名...',
    'table.rule_desc': '规则描述',
    'table.code_label_short': 'JavaScript 代码（可手写或 AI 生成）',

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
    'app.testing': 'Testing...',
    'app.loading': 'Loading...',
    'app.confirm': 'Confirm',
    'app.search': 'Search',
    'app.none': 'None',
    'app.projects_count': '{0} projects',

    'home.title': 'Projects',
    'home.new_project': 'New Project',
    'home.no_projects': 'No projects yet',
    'home.no_projects_desc': 'Create your first project to start synthesizing data',
    'home.settings_hint': 'Configure',

    'project.new_title': 'New Project',
    'project.name_placeholder': 'Enter project name...',
    'project.create_btn': 'Create Project',
    'project.name_required': 'Project name is required',
    'project.not_found': 'Project not found',

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

    // ---- Column types ----
    'coltype.text': 'Text (LLM)',
    'coltype.text_short': 'Text',
    'coltype.text_create': 'Text (LLM)',
    'coltype.number': 'Number (Code)',
    'coltype.number_short': 'Number',
    'coltype.number_create': 'Number (Code)',
    'coltype.boolean': 'Boolean',
    'coltype.boolean_short': 'Bool',
    'coltype.date': 'Date',
    'coltype.date_short': 'Date',
    'coltype.id': 'ID (Auto/Snowflake)',
    'coltype.id_short': 'ID',
    'coltype.phone': 'Phone',
    'coltype.phone_short': 'Phone',
    'coltype.city': 'City',
    'coltype.city_short': 'City',
    'coltype.foreign_key': 'Foreign Key',
    'coltype.foreign_key_create': 'Foreign Key (ref)',
    'coltype.foreign_key_array': 'FK Array',

    // ---- Countries ----
    'country.CN': 'China (+86)',
    'country.US': 'USA (+1)',
    'country.JP': 'Japan (+81)',
    'country.KR': 'Korea (+82)',
    'country.GB': 'UK (+44)',
    'country.DE': 'Germany (+49)',
    'country.FR': 'France (+33)',
    'country.IN': 'India (+91)',
    'country.BR': 'Brazil (+55)',
    'country.AU': 'Australia (+61)',
    'country.CN_short': 'China',

    // ---- ID formats ----
    'idfmt.uuid4': 'UUID v4',
    'idfmt.uuid7': 'UUID v7',
    'idfmt.snowflake': 'Snowflake ID',
    'idfmt.auto_increment': 'Auto Increment',
    'idfmt.cuid2': 'CUID2',
    'idfmt.objectid': 'MongoDB ObjectID',
    'idfmt.nanoid': 'Nano ID',
    'idfmt.ulid': 'ULID',

    // ---- Date formats ----
    'datefmt.date': 'yyyy-MM-dd',
    'datefmt.datetime': 'yyyy-MM-dd HH:mm:ss',
    'datefmt.iso': 'ISO 8601',
    'datefmt.date_slash': 'yyyy/MM/dd',
    'datefmt.date_us': 'MM/dd/yyyy',
    'datefmt.date_eu': 'dd-MM-yyyy',
    'datefmt.time': 'HH:mm:ss',
    'datefmt.unix_s': 'Unix timestamp (s)',
    'datefmt.unix_ms': 'Unix timestamp (ms)',

    // ---- Date ranges ----
    'daterange.7d': 'Last 7 days',
    'daterange.15d': 'Last 15 days',
    'daterange.30d': 'Last 30 days',
    'daterange.90d': 'Last 3 months',
    'daterange.180d': 'Last 6 months',
    'daterange.1y': 'Last 1 year',
    'daterange.3y': 'Last 3 years',

    // ---- Table editor ----
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
    'table.not_found': 'Table not found',
    'table.back_to_project': 'Back to project',

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
    'table.create_empty': 'Create Empty Rows',
    'table.import_nuwa': 'Import .nuwa',
    'table.export_nuwa': 'Export .nuwa',
    'table.no_llm': 'No LLM',
    'table.columns': 'Columns',
    'table.columns_generated': '({0}/{1} cols generated)',
    'table.nullable': 'Nullable',
    'table.prompt_empty': 'Prompt empty',
    'table.fk_missing_warn': 'Some foreign key references point to non-existent tables.',
    'table.prompt_empty_warn': '{0}: prompt is empty, cannot generate.',
    'table.fk_ref': '{0}: prompt is empty, cannot generate. Edit schema to fix.',
    'table.drag_hint': 'Drag to reorder',
    'table.insert_col': '+ Insert Column',
    'table.insert_col_hint': 'Insert new column here',

    // Edit mode form
    'table.text_prompt_placeholder': 'Describe how to generate text for this column...',
    'table.number_prompt_placeholder': 'Describe your number rule, e.g.: random latitude in China',
    'table.date_prompt_placeholder': 'Describe date rule, e.g.: random date in last 30 days',
    'table.ai_gen_code': 'AI Generate Code',
    'table.code_placeholder': 'JavaScript code, return value as column data. Write manually or use AI.',
    'table.code_placeholder_short': 'JavaScript code, write manually or use AI',
    'table.test_code': 'Test Code (preview 5)',
    'table.test_result': 'Test Results (5 rows):',
    'table.code_error': 'Code Error:',
    'table.gen_fail': 'Generation failed',
    'table.select_ref_table': 'Select reference table...',
    'table.auto_match_col': 'Auto-match column',
    'table.date_distribution': 'Time distribution ratio (%)',
    'table.bool_placeholder': 'Optional, random true/false if empty',
    'table.allow_null': 'Allow null',
    'table.null_ratio': 'Ratio',
    'table.gen_col_hint': 'Generate {0} column data',

    // Pagination
    'table.per_page': 'Per page',
    'table.page_info': 'rows · {0} total',

    // Import/Export errors
    'table.import_fail': 'Import failed',
    'table.gen_fail_short': 'Generation failed',
    'table.image_too_large': 'Image must be under 10MB',
    'table.image_fail': 'Image recognition failed',
    'table.image_no_columns': 'Could not identify column structure from image. Ensure the image contains table information.',
    'table.image_read_fail': 'Failed to read image',
    'table.image_load_fail': 'Failed to load image',
    'table.invalid_nuwa': 'Invalid .nuwa file format',
    'table.save_data_fail': 'Failed to save data',

    // FK errors
    'table.fk_table_missing': 'Referenced table "{0}" does not exist',
    'table.fk_no_data': 'Referenced table "{0}" has no data, generate its data first',
    'table.fk_foreign_key': 'FK',

    // Stats
    'stats.title': 'Statistics',
    'stats.close': 'Close Statistics',
    'stats.count': 'Count',
    'stats.mean': 'Mean',
    'stats.median': 'Median',
    'stats.std': 'Std Dev',
    'stats.min_max': 'Min / Max',
    'stats.q1_q3': 'Q1 / Q3',
    'stats.distribution': 'Distribution',
    'stats.avg_len': 'Avg Length',
    'stats.chars': 'chars',
    'stats.min_max_len': 'Min / Max Length',
    'stats.unique': 'Unique',
    'stats.top_words': 'Top Words',
    'stats.city_mentions': 'City Mentions',
    'stats.earliest': 'Earliest',
    'stats.latest': 'Latest',
    'stats.span': 'Span',
    'stats.days': 'days',
    'stats.by_month': 'By Month',
    'stats.true_ratio': 'True Ratio',
    'stats.duplicates': 'Duplicates',
    'stats.unique_rate': 'Unique Rate',
    'stats.distinct': 'Distinct',
    'stats.nulls': 'Nulls',
    'stats.top_values': 'Top Values',
    'stats.by_province': 'By Province',
    'stats.total_rows': '{0} rows total',

    // Settings
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
    'settings.description': 'API Key is stored server-side and never exposed to the browser. All projects share this configuration.',
    'settings.select_provider': 'Select Provider',
    'settings.api_format': 'API Format',
    'settings.format_openai': 'OpenAI Compatible',
    'settings.format_anthropic': 'Anthropic Compatible',
    'settings.key_saved_hint': 'API Key stored — enter new value to overwrite',
    'settings.key_not_saved_hint': 'API Key stored server-side only',
    'settings.request_url': 'Request URL:',
    'settings.request_fail': 'Request failed',
    'settings.network_fail': 'Network request failed',

    // API errors
    'api.not_configured': 'LLM not configured. Please configure in Settings first.',
    'api.vision_not_supported': 'Image recognition only supports multimodal API formats (DeepSeek, GPT-4V, etc.)',
    'api.missing_prompt': 'Missing prompt',
    'api.unknown_error': 'Unknown error',
    'api.cannot_connect': 'Cannot connect to',
    'api.check_url': 'Please check Base URL and API format',
    'api.endpoint_not_found': 'Endpoint not found',
    'api.current_format': 'Current API format',
    'api.auth_fail': 'Authentication failed',
    'api.check_key': 'Please check your API Key',
    'api.api_error': 'API Error',
    'api.no_response': '(no response)',
    'api.request_url_label': 'Request URL',
    'api.save_fail': 'Save failed',

    // Image recognition
    'image.recognizing': 'Recognizing...',
    'image.recognize_btn': 'OCR Import',

    // FK mode
    'fk.mode_fk': 'FK mode (click to toggle)',
    'fk.mode_direct': 'Direct value mode (click to toggle)',

    // Table create form labels
    'table.fk_ref_table': 'Reference Table',
    'table.fk_select_table': 'Select table...',
    'table.fk_ref_col': 'Reference Column (optional)',
    'table.fk_auto_match': 'Auto match',
    'table.id_format': 'ID Format',
    'table.country': 'Country',
    'table.code_label': 'Code (optional, return value → boolean)',
    'table.llm_configured_banner': 'LLM configured. Text columns will use model generation.',
    'table.prompt_label': 'Generation Prompt (describe how LLM should generate data)',
    'table.prompt_example': 'e.g.: Generate a full English name...',
    'table.rule_desc': 'Rule Description',
    'table.code_label_short': 'JavaScript Code (manual or AI generated)',

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
