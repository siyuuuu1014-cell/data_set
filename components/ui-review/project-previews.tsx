'use client'

import { useState } from 'react'
import type { PreviewState } from './review-data'
import { PreviewChrome, SkeletonRows, StatePanel } from './preview-primitives'
import { SlidingControl } from './SlidingControl'
import styles from './ui-review.module.css'

const DATA_PROJECTS = [
  { name: '零售用户画像', date: '2026 年 7 月 31 日', tables: 3, rows: '24,680', activity: '刚刚更新' },
  { name: '跨境订单样本', date: '2026 年 7 月 28 日', tables: 2, rows: '18,240', activity: '2 天前更新' },
  { name: '客服意图训练集', date: '2026 年 7 月 24 日', tables: 2, rows: '9,600', activity: '6 天前更新' },
  { name: '供应链压力测试', date: '2026 年 7 月 19 日', tables: 1, rows: '5,922', activity: '11 天前更新' },
]

export function DataProjectsPreview({ state }: { state: PreviewState }) {
  const [filter, setFilter] = useState<'all' | 'recent' | 'data'>('all')
  const visibleProjects = filter === 'recent'
    ? DATA_PROJECTS.slice(0, 2)
    : filter === 'data'
      ? DATA_PROJECTS.filter(project => Number(project.rows.replace(',', '')) >= 10000)
      : DATA_PROJECTS

  return (
    <PreviewChrome area="数据合成">
      <main className={`${styles.productPage} ${styles.dataProjectPreview}`}>
        <header className={styles.pageCommandHeader}>
          <div>
            <span>本地数据工作区</span>
            <h1>数据项目</h1>
            <p>组织 Schema、生成规则和本地数据文件。项目操作不会离开当前设备。</p>
          </div>
          <button type="button" className={styles.primaryButton}>创建数据项目</button>
        </header>

        <section className={styles.operationalStrip} aria-label="数据项目概览">
          <div><span>项目</span><strong>4</strong></div>
          <div><span>数据表</span><strong>8</strong></div>
          <div><span>本地记录</span><strong>58,442</strong></div>
          <div><span>配置状态</span><strong className={styles.goodText}>可生成</strong></div>
        </section>

        <div className={styles.projectDirectoryToolbar}>
          <label className={styles.projectSearch}>搜索项目<input value="" placeholder="按项目名称搜索" readOnly /></label>
          <SlidingControl
            value={filter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'recent', label: '最近更新' },
              { value: 'data', label: '数据量较大' },
            ]}
            onChange={setFilter}
            label="筛选数据项目"
          />
        </div>

        {state === 'loading' ? <SkeletonRows count={5} /> : state === 'empty' ? (
          <StatePanel kind="empty" title="还没有数据项目" description="创建项目后即可定义数据表、字段与生成规则。" action="创建第一个项目" />
        ) : state === 'error' ? (
          <StatePanel kind="error" title="无法读取本地项目" description="项目索引暂时不可用。现有数据文件不会受到影响。" action="重新读取" />
        ) : (
          <section className={styles.projectDirectory} aria-label="项目目录">
            <header><span>项目</span><span>规模</span><span>最近活动</span><span>操作</span></header>
            {visibleProjects.map((project, index) => (
              <article key={project.name}>
                <div className={styles.projectDirectoryName}>
                  <span className={styles.projectMonogram}>{project.name.slice(0, 1)}</span>
                  <span><strong>{project.name}</strong><small>创建于 {project.date}</small></span>
                </div>
                <div className={styles.projectScale}><strong>{project.tables} 个表</strong><small>{project.rows} 行</small></div>
                <time>{project.activity}</time>
                <div className={styles.projectRowActions}>
                  <button type="button">打开</button>
                  <button type="button" className={styles.quietDanger} aria-label={`删除 ${project.name}`}>{index === 0 ? '更多' : '删除'}</button>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </PreviewChrome>
  )
}

export function NewDataProjectPreview({ state }: { state: PreviewState }) {
  const hasError = state === 'error'
  const isEmpty = state === 'empty' || hasError

  return (
    <PreviewChrome area="数据合成">
      <main className={`${styles.productPage} ${styles.projectCreatePage}`}>
        <button type="button" className={styles.inlineBack}>返回数据项目</button>
        <div className={styles.projectCreateHeading}>
          <h1>创建数据项目</h1>
          <p>项目是数据表、关联关系和生成规则的工作边界。创建后可立即添加第一张表。</p>
        </div>

        {state === 'loading' ? <SkeletonRows count={3} /> : state === 'success' ? (
          <section className={styles.creationSuccess} role="status">
            <span>完成</span>
            <div><h2>“零售用户画像”已创建</h2><p>项目当前为空。下一步可以定义第一张数据表。</p></div>
            <button type="button" className={styles.primaryButton}>创建数据表</button>
          </section>
        ) : (
          <form className={styles.projectCreateForm} noValidate>
            <div className={styles.formField}>
              <label htmlFor="review-project-name">项目名称</label>
              <input
                id="review-project-name"
                value={isEmpty ? '' : '零售用户画像'}
                placeholder="例如：零售用户画像"
                aria-invalid={hasError}
                aria-describedby={hasError ? 'review-project-error' : 'review-project-help'}
                readOnly
              />
              {hasError
                ? <p id="review-project-error" className={styles.formError} role="alert">请输入项目名称后再创建。</p>
                : <p id="review-project-help">建议使用业务目标命名，后续仍可在项目设置中修改。</p>}
            </div>
            <div className={styles.formOutcome}>
              <strong>创建后</strong>
              <span>进入项目详情</span>
              <span>定义数据表与字段</span>
              <span>配置本地生成规则</span>
            </div>
            <div className={styles.formActions}>
              <button type="button">取消</button>
              <button type="button" className={styles.primaryButton}>创建并继续</button>
            </div>
          </form>
        )}
      </main>
    </PreviewChrome>
  )
}

const PROJECT_TABLES = [
  { name: 'user_profiles', columns: ['user_id · ID', 'name · text', 'city · city', 'status · text'], totalColumns: 11, rows: '24,680' },
  { name: 'orders', columns: ['order_id · ID', 'user_id · FK', 'amount · number', 'created_at · date'], totalColumns: 8, rows: '18,240' },
  { name: 'product_catalog', columns: ['sku · ID', 'title · text', 'category · text'], totalColumns: 7, rows: '3,860' },
]

export function DataProjectDetailPreview({ state }: { state: PreviewState }) {
  return (
    <PreviewChrome area="数据合成">
      <div className={styles.projectContextPreview}>
        <button type="button">返回</button>
        <div><span>合成数据项目</span><strong>零售用户画像</strong></div>
      </div>
      <main className={`${styles.productPage} ${styles.dataProjectDetail}`}>
        <header className={styles.pageCommandHeader}>
          <div><span>数据表目录</span><h1>数据表 · 3</h1><p>管理项目中的表结构、关联顺序和本地数据文件。</p></div>
          <div className={styles.detailActions}><button type="button">批量导出</button><button type="button" className={styles.primaryButton}>创建数据表</button></div>
        </header>

        <section className={styles.operationalStrip} aria-label="项目概览">
          <div><span>数据表</span><strong>3</strong></div>
          <div><span>字段</span><strong>26</strong></div>
          <div><span>记录</span><strong>46,780</strong></div>
          <div><span>存储</span><strong className={styles.goodText}>Parquet</strong></div>
        </section>

        {state === 'loading' ? <SkeletonRows count={4} /> : state === 'empty' ? (
          <StatePanel kind="empty" title="项目中还没有数据表" description="先定义一张表的字段，再生成或导入本地数据。" action="创建第一张表" />
        ) : state === 'error' ? (
          <StatePanel kind="error" title="表目录暂时不可用" description="无法读取项目的表索引。Parquet 文件仍保留在本地。" action="重新读取目录" />
        ) : (
          <section className={styles.projectTableDirectory} aria-label="数据表目录">
            {PROJECT_TABLES.map((table, index) => (
              <article key={table.name}>
                <span className={styles.reorderLabel}>排序 {index + 1}</span>
                <div className={styles.projectTableIdentity}>
                  <strong>{table.name}</strong>
                  <small>{table.totalColumns} 个字段 · {table.rows} 行</small>
                  <div>{table.columns.map(column => <span key={column}>{column}</span>)}</div>
                </div>
                <div className={styles.projectTableActions}><button type="button">打开数据</button><button type="button">导出</button><button type="button" className={styles.quietDanger}>删除</button></div>
              </article>
            ))}
          </section>
        )}
      </main>
    </PreviewChrome>
  )
}

const SCHEMA_COLUMNS = [
  { name: 'user_id', type: 'ID', detail: 'UUID v7', ready: true },
  { name: 'full_name', type: '文本', detail: '由 LLM 生成中文姓名', ready: true },
  { name: 'city', type: '城市', detail: '中国城市分布', ready: true },
  { name: 'created_at', type: '日期', detail: '最近 365 天', ready: false },
]

type BuilderSectionKey = 'identity' | 'relations' | 'fields' | 'check'

const BUILDER_SECTIONS = [
  { value: 'identity', label: '基本信息', description: '名称与导入' },
  { value: 'relations', label: '关联数据', description: '引用已有表' },
  { value: 'fields', label: '字段定义', description: '类型与生成规则' },
  { value: 'check', label: '生成检查', description: '确认完整性' },
] satisfies { value: BuilderSectionKey; label: string; description: string }[]

export function NewDataTablePreview({ state }: { state: PreviewState }) {
  const isEmpty = state === 'empty'
  const hasError = state === 'error'
  const [activeSection, setActiveSection] = useState<BuilderSectionKey>('fields')
  const [expandedColumn, setExpandedColumn] = useState(1)
  const visibleColumns = isEmpty
    ? [{ name: '', type: '文本', detail: '等待配置', ready: false }]
    : SCHEMA_COLUMNS
  const currentBuilderSection = BUILDER_SECTIONS.find(section => section.value === activeSection) ?? BUILDER_SECTIONS[0]

  return (
    <PreviewChrome area="数据合成" compact>
      <main className={styles.tableBuilderPreview}>
        <header className={styles.builderPreviewHeader}>
          <div><button type="button">返回项目</button><span>零售用户画像</span></div>
          <strong>创建数据表</strong>
          <span className={styles.statusLabel} data-tone="success">LLM 已配置</span>
        </header>

        {state === 'loading' ? <div className={styles.builderLoading}><SkeletonRows count={6} /></div> : state === 'success' ? (
          <section className={styles.builderSuccess} role="status"><span>Schema 已保存</span><h1>user_profiles 已创建</h1><p>4 个字段已通过检查，现在可以生成第一批数据。</p><button type="button" className={styles.primaryButton}>进入数据表</button></section>
        ) : (
          <div className={styles.schemaBuilderLayout} aria-busy={state === 'processing'}>
            <aside className={styles.schemaBuilderRail}>
              <div className={styles.builderRailTop}>
                <div className={styles.builderRailIdentity}>
                  <span>数据结构工作台</span>
                  <strong>{isEmpty ? '未命名数据表' : 'user_profiles'}</strong>
                  <small>零售用户画像 · 本地项目</small>
                </div>
                <nav className={styles.builderRailNavigation} aria-label="数据表工作台导览">
                  <span className={styles.railTitle}>工作台导览</span>
                  <SlidingControl
                    value={activeSection}
                    options={BUILDER_SECTIONS}
                    onChange={setActiveSection}
                    label="创建数据表目录"
                    orientation="vertical"
                  />
                </nav>
              </div>
              <div className={styles.builderRailFooter}>
                <div className={styles.builderRailCheck}>
                  <div><span>工作台完整度</span><strong>{isEmpty ? '25%' : '75%'}</strong></div>
                  <div className={styles.builderProgressTrack} aria-hidden="true"><span style={{ transform: `scaleX(${isEmpty ? 0.25 : 0.75})` }} /></div>
                  <ul>
                    <li data-ready={!isEmpty}>表名</li>
                    <li data-ready={!isEmpty}>字段名称</li>
                    <li data-ready={false}>生成规则</li>
                    <li data-ready>LLM 服务</li>
                  </ul>
                  <button type="button" onClick={() => setActiveSection('check')}>查看生成检查</button>
                </div>
                <button type="button" className={styles.primaryButton} disabled={isEmpty || hasError}>创建数据表</button>
              </div>
            </aside>

            <section className={styles.builderWorkspace}>
              <header className={styles.builderWorkspaceBar}>
                <div><span>当前工作区</span><strong>{currentBuilderSection.label}</strong></div>
                <small>{currentBuilderSection.description} · 悬停预览导览位置，点击后切换工作区</small>
              </header>
              <form className={styles.schemaBuilderMain} onSubmit={event => event.preventDefault()} noValidate>
              {activeSection === 'identity' && <section className={styles.builderSection}>
                <div className={styles.builderSectionHeading}><div><h1>定义数据表</h1><p>先设置表名，再逐个确认字段。高级生成规则仅在展开字段时显示。</p></div><button type="button">导入 .nuwa</button></div>
                <div className={styles.formField}>
                  <label htmlFor="review-table-name">数据表名称</label>
                  <input id="review-table-name" value={isEmpty || hasError ? '' : 'user_profiles'} placeholder="例如：user_profiles" aria-invalid={hasError} readOnly />
                  {hasError ? <p className={styles.formError} role="alert">请输入数据表名称，并确保项目中没有同名表。</p> : <p>建议使用 snake_case，名称将用于本地文件和导出结果。</p>}
                </div>
                <div className={styles.identityHints}><div><span>本地文件</span><strong>user_profiles.parquet</strong></div><div><span>创建位置</span><strong>零售用户画像</strong></div></div>
              </section>}

              {activeSection === 'relations' && <section className={styles.builderSection}>
                <div className={styles.builderSectionHeading}><div><h2>关联已有数据</h2><p>仅在需要外键或复用字段时选择。</p></div><button type="button">选择关联表</button></div>
                <div className={styles.relatedTablePreview}><label><input type="checkbox" checked readOnly />orders</label><span>8 个字段</span><small>已引用 user_id</small></div>
                <div className={styles.relationMapping}>
                  <div><span>当前字段</span><strong>user_id</strong></div><span>引用</span><div><span>orders 字段</span><strong>user_id</strong></div><select defaultValue="外键"><option>外键</option><option>直接值</option></select>
                </div>
              </section>}

              {activeSection === 'fields' && <section className={styles.builderSection}>
                <div className={styles.builderSectionHeading}><div><h2>字段定义</h2><p>{isEmpty ? '从第一个字段开始定义。' : '4 个字段，其中 1 个需要补充规则。'}</p></div><button type="button" className={styles.primaryButton}>添加字段</button></div>
                <div className={styles.schemaColumnList}>
                  {visibleColumns.map((column, index) => (
                    <article key={column.name || 'new-column'} data-expanded={expandedColumn === index || undefined}>
                      <header>
                        <span className={styles.fieldOrder}>{index + 1}</span>
                        <label className={styles.schemaFieldName}><span>字段名称</span><input value={column.name} placeholder="字段名称" readOnly /></label>
                        <label className={styles.schemaFieldType}><span>字段类型</span><select defaultValue={column.type} aria-label={`${column.name || '新字段'}类型`}><option>{column.type}</option></select></label>
                        <div className={styles.schemaFieldState}><small data-ready={column.ready}>{column.ready ? '已配置' : '待完善'}</small><span>{column.detail}</span></div>
                        <button type="button" onClick={() => setExpandedColumn(expandedColumn === index ? -1 : index)}>{expandedColumn === index ? '收起配置' : '配置规则'}</button>
                      </header>
                      {expandedColumn === index && !isEmpty && (
                        <div className={styles.schemaColumnExpanded}>
                          <label className={styles.promptField}><span>生成提示词</span><textarea value={column.type === '文本' ? '生成符合中国常见姓名规则的中文姓名，包含姓和名。' : column.detail} readOnly /></label>
                          <div className={styles.fieldConfigStack}>
                            <label><span>生成方式</span><select defaultValue={column.type === '文本' ? 'LLM 文本生成' : '内置规则'}><option>{column.type === '文本' ? 'LLM 文本生成' : '内置规则'}</option></select></label>
                            <label><span>空值策略</span><select defaultValue="不允许为空"><option>不允许为空</option></select></label>
                          </div>
                          <div className={styles.fieldRuleSummary}><span>字段输出</span><strong>{column.name || '等待命名'}</strong><small>{column.detail}</small></div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>}

              {activeSection === 'check' && <section className={`${styles.builderSection} ${styles.generationReview}`}>
                <div className={styles.builderSectionHeading}><div><h2>生成检查</h2><p>在创建数据表前确认名称、字段规则和依赖服务。</p></div><span className={styles.statusLabel} data-tone="warning">1 项待完善</span></div>
                <dl className={styles.generationMetrics}><div><dt>字段</dt><dd>{isEmpty ? 1 : 4}</dd></div><div><dt>已配置</dt><dd>{isEmpty ? 0 : 3}</dd></div><div><dt>关联表</dt><dd>1</dd></div><div><dt>预计可生成</dt><dd>{isEmpty ? 0 : 3} 列</dd></div></dl>
                <div className={styles.generationChecklist}>
                  <article data-ready={!isEmpty}><span>{isEmpty ? '待处理' : '通过'}</span><div><strong>表名与文件路径</strong><small>{isEmpty ? '需要填写表名。' : 'user_profiles.parquet 可以创建。'}</small></div><button type="button" onClick={() => setActiveSection('identity')}>查看</button></article>
                  <article data-ready={!isEmpty}><span>{isEmpty ? '待处理' : '通过'}</span><div><strong>字段名称与类型</strong><small>{isEmpty ? '第一个字段尚未命名。' : '4 个字段名称唯一，类型有效。'}</small></div><button type="button" onClick={() => setActiveSection('fields')}>查看</button></article>
                  <article data-ready="false"><span>待处理</span><div><strong>生成规则完整性</strong><small>created_at 尚未设置日期范围。</small></div><button type="button" onClick={() => { setActiveSection('fields'); setExpandedColumn(3) }}>修复</button></article>
                  <article data-ready><span>通过</span><div><strong>LLM 服务连接</strong><small>文本生成模型已配置并可访问。</small></div><button type="button">测试</button></article>
                </div>
                <div className={styles.generationActions}><p>完成待处理项目后即可创建数据表。</p><button type="button" className={styles.primaryButton} disabled={isEmpty || hasError}>创建数据表</button></div>
              </section>}
              </form>
            </section>

            {state === 'processing' && <div className={styles.builderProcessing} role="status"><span /><strong>正在解析导入文件</strong><small>已识别 3 / 4 个字段</small></div>}
          </div>
        )}
      </main>
    </PreviewChrome>
  )
}
