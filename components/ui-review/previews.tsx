import type { PreviewKey, PreviewState } from './review-data'
import {
  DataProjectDetailPreview,
  DataProjectsPreview,
  NewDataProjectPreview,
  NewDataTablePreview,
} from './project-previews'
import { PreviewChrome, SkeletonRows, StatePanel } from './preview-primitives'
import { SharedSettingsPreview, SystemStatusPreview, WorkspaceRestorePreview } from './support-previews'
import { AnnotationExportPreview, IdentityManagerPreview, TableStatisticsPreview, VideoUploadPreview } from './operation-previews'
import styles from './ui-review.module.css'

function HomePreview({ state }: { state: PreviewState }) {
  return (
    <PreviewChrome area="工作区入口">
      <main className={styles.homePreview}>
        {state === 'loading' ? (
          <div className={styles.homeLoading}><SkeletonRows count={3} /></div>
        ) : state === 'error' ? (
          <StatePanel
            kind="error"
            title="工作区状态暂时不可用"
            description="本地服务没有返回状态。你仍可进入工作区，或先重新检查服务。"
            action="重新检查"
          />
        ) : (
          <>
            <section className={styles.homeThesis}>
              <div className={styles.homeStatement}>
                <span>本地优先的智能数据工作台</span>
                <h1>把素材变成可审核、可交付的数据。</h1>
                <p>在同一个本地工具中构造结构化数据，运行视频预标注，并由人工完成最终确认。</p>
              </div>
              <div className={styles.pipelineProof} aria-label="Nuwa 数据处理流程">
                <div className={styles.pipelineInput}>
                  <span>输入</span>
                  <strong>Schema</strong>
                  <strong>Video</strong>
                </div>
                <div className={styles.pipelineCore}>
                  <small>NUWA LOCAL PIPELINE</small>
                  <strong>生成</strong>
                  <strong>识别</strong>
                  <strong>审核</strong>
                </div>
                <div className={styles.pipelineOutput}>
                  <span>输出</span>
                  <strong>Dataset</strong>
                  <strong>Annotation</strong>
                </div>
              </div>
            </section>

            <section className={styles.workspaceEntries}>
              <article>
                <div className={styles.entryIndex}>数据合成</div>
                <div>
                  <h2>构造结构化数据</h2>
                  <p>设计表结构，调用 LLM 生成字段值，并导出 JSON、CSV、XLSX、SQL 或 Parquet。</p>
                  <ul><li>9 种列类型</li><li>关系表引用</li><li>多格式导出</li></ul>
                </div>
                <button type="button">进入数据合成</button>
              </article>
              <article>
                <div className={styles.entryIndex}>视频标注</div>
                <div>
                  <h2>审核 AI 视频标注</h2>
                  <p>批量上传视频，运行本地 Pipeline，逐帧修正实体、时间线、身份与语义结果。</p>
                  <ul><li>本地 CUDA Worker</li><li>人工审核闭环</li><li>COCO / YOLO 导出</li></ul>
                </div>
                <button type="button">进入视频标注</button>
              </article>
            </section>
          </>
        )}
      </main>
    </PreviewChrome>
  )
}

const ANNOTATION_PROJECTS = [
  { name: 'test', videos: 10, status: '需要复核', tone: 'warning', progress: '8 / 10', updated: '今天 16:24' },
  { name: 'ign', videos: 1, status: '降级完成', tone: 'warning', progress: '1 / 1', updated: '7 月 24 日' },
  { name: 'butterfly', videos: 1, status: '降级完成', tone: 'warning', progress: '1 / 1', updated: '7 月 22 日' },
  { name: 'test_video', videos: 2, status: '待处理', tone: 'neutral', progress: '0 / 2', updated: '7 月 23 日' },
]

function AnnotationProjectsPreview({ state }: { state: PreviewState }) {
  return (
    <PreviewChrome area="视频标注">
      <main className={styles.productPage}>
        <header className={styles.pageCommandHeader}>
          <div><span>视频标注</span><h1>标注项目</h1><p>上传视频，跟踪处理进度，并集中处理需要人工确认的结果。</p></div>
          <button type="button" className={styles.primaryButton}>新建标注项目</button>
        </header>
        <section className={styles.operationalStrip} aria-label="标注项目摘要">
          <div><span>项目</span><strong>6</strong></div>
          <div><span>视频</span><strong>17</strong></div>
          <div><span>需要复核</span><strong>3</strong></div>
          <div><span>Worker</span><strong className={styles.goodText}>CUDA 就绪</strong></div>
        </section>

        <div className={styles.listToolbar}>
          <div className={styles.searchField}>搜索项目或视频</div>
          <div className={styles.filterGroup}><button type="button" aria-pressed="true">全部</button><button type="button">待处理</button><button type="button">需复核</button><button type="button">已完成</button></div>
        </div>

        {state === 'loading' ? <SkeletonRows /> : state === 'empty' ? (
          <StatePanel kind="empty" title="还没有标注项目" description="创建项目并添加视频后，处理进度和质量问题会显示在这里。" action="创建第一个项目" />
        ) : state === 'error' ? (
          <StatePanel kind="error" title="无法读取标注项目" description="文件任务服务没有返回项目列表。现有数据没有被修改。" action="重新加载" />
        ) : (
          <section className={styles.projectQueue}>
            <div className={styles.queueHeader}><span>项目</span><span>处理范围</span><span>状态</span><span>最近更新</span><span>下一步</span></div>
            {ANNOTATION_PROJECTS.map(project => (
              <article key={project.name}>
                <div><strong>{project.name}</strong><small>{project.videos} 个视频</small></div>
                <div><strong>{project.progress}</strong><small>视频完成</small></div>
                <span className={styles.statusLabel} data-tone={project.tone}>{project.status}</span>
                <time>{project.updated}</time>
                <button type="button">{project.tone === 'warning' ? '开始复核' : '打开项目'}</button>
              </article>
            ))}
          </section>
        )}
      </main>
    </PreviewChrome>
  )
}

const QUALITY_ISSUES = [
  { kind: '降级结果', video: '苹果太太的厨房-玫瑰酱.mp4', detail: '语义模型未完成，保留检测与追踪结果' },
  { kind: '身份冲突', video: '成为你们.mp4', detail: '人物 03 在相邻片段中出现两个候选身份' },
  { kind: '待审核', video: '春日来信.mp4', detail: '32 个片段尚未确认' },
]

function AnnotationProjectPreview({ state }: { state: PreviewState }) {
  const isPartial = state === 'partial'
  const isProcessing = state === 'processing'
  return (
    <PreviewChrome area="视频标注">
      <main className={styles.productPage}>
        <header className={styles.pageCommandHeader}>
          <div><span>标注项目</span><h1>test</h1><p>10 个视频，集中处理质量问题并完成最终审核。</p></div>
          <button type="button" className={styles.primaryButton}>添加视频</button>
        </header>
        <section className={styles.operationalStrip}>
          <div><span>视频</span><strong>10</strong></div><div><span>片段</span><strong>184</strong></div>
          <div><span>需要复核</span><strong>3</strong></div><div><span>处理进度</span><strong>82%</strong></div>
        </section>

        {state === 'loading' ? <SkeletonRows count={5} /> : state === 'empty' ? (
          <StatePanel kind="empty" title="项目中还没有视频" description="添加 MP4、MOV、AVI 或 WebM 文件后，Nuwa 将创建本地处理任务。" action="选择视频" />
        ) : state === 'error' ? (
          <StatePanel kind="error" title="项目详情加载失败" description="任务文件无法读取。请检查本地文件状态或重新加载。" action="重新加载" />
        ) : (
          <div className={styles.annotationProjectLayout}>
            <aside className={styles.qualityRail}>
              <div><h2>质量队列</h2><span>3 项</span></div>
              <div className={styles.qualityFilters}><button type="button" aria-pressed="true">全部</button><button type="button">关键</button><button type="button">警告</button></div>
              <div className={styles.issueList}>
                {QUALITY_ISSUES.map((issue, index) => <button type="button" key={issue.video} aria-current={index === 0 ? 'true' : undefined}><span>{issue.kind}</span><strong>{issue.video}</strong><small>{issue.detail}</small></button>)}
              </div>
            </aside>
            <section className={styles.videoQueue}>
              <div className={styles.videoQueueHeader}><div><h2>视频</h2><p>按风险和下一步动作排序</p></div><button type="button">筛选与排序</button></div>
              {(isProcessing ? ANNOTATION_PROJECTS.slice(0, 3) : ANNOTATION_PROJECTS).map((item, index) => (
                <article key={`${item.name}-${index}`}>
                  <div className={styles.videoThumb}><span>{String(index + 1).padStart(2, '0')}</span></div>
                  <div className={styles.videoInfo}>
                    <strong>{index === 0 ? '苹果太太的厨房-玫瑰酱.mp4' : index === 1 ? '春日来信.mp4' : `${item.name}.mp4`}</strong>
                    <small>{index === 1 ? '132 秒 · 30 FPS · 32 片段' : '74 秒 · 24 FPS · 26 片段'}</small>
                  </div>
                  <div className={styles.videoProgress}><span style={{ width: `${index === 0 ? 78 : 100}%` }} /><small>{isProcessing && index === 0 ? '正在运行语义识别' : isPartial && index === 0 ? '降级完成' : '已完成'}</small></div>
                  <span className={styles.statusLabel} data-tone={index === 0 ? 'warning' : 'success'}>{index === 0 ? (isProcessing ? '处理中' : '需要复核') : '已完成'}</span>
                  <button type="button">{index === 0 ? '复核结果' : '查看'}</button>
                </article>
              ))}
            </section>
          </div>
        )}
      </main>
    </PreviewChrome>
  )
}

const SCENES = [
  { id: '00:00-00:05', label: '厨房全景', status: '已通过' },
  { id: '00:05-00:11', label: '人物近景', status: '待审核' },
  { id: '00:11-00:18', label: '操作特写', status: '处理中' },
  { id: '00:18-00:26', label: '人物与物体', status: '降级结果' },
  { id: '00:26-00:34', label: '台面特写', status: '待处理' },
]

function WorkbenchStateOverlay({ state }: { state: PreviewState }) {
  if (state === 'loading') return <div className={styles.workbenchOverlay}><span className={styles.largeSpinner} /><strong>正在准备视频与标注数据</strong><small>读取本地帧索引、片段和人工审核记录</small></div>
  if (state === 'error') return <div className={styles.workbenchOverlay} data-error="true"><span className={styles.stateMark}>!</span><strong>无法加载当前视频</strong><small>视频文件或任务数据不可用。现有审核结果未被修改。</small><button type="button">返回项目</button></div>
  return null
}

function AnnotationWorkbenchPreview({ state }: { state: PreviewState }) {
  const partial = state === 'partial'
  const processing = state === 'processing'
  const approved = state === 'approved'
  return (
    <PreviewChrome area="视频标注" compact>
      <main className={styles.workbench}>
        <header className={styles.workbenchCommandbar}>
          <div><button type="button">返回项目</button><strong>苹果太太的厨房-玫瑰酱.mp4</strong><span>片段 02 / 26</span></div>
          <div><span className={styles.statusLabel} data-tone={approved ? 'success' : partial ? 'warning' : processing ? 'info' : 'neutral'}>{approved ? '已通过' : partial ? '降级结果' : processing ? '正在处理' : '待审核'}</span><button type="button">导出</button><button type="button" className={styles.primaryButton}>保存审核</button></div>
        </header>

        <div className={styles.workbenchGrid}>
          <aside className={styles.sceneRail}>
            <div><h2>场景</h2><button type="button">重新检测</button></div>
            <div className={styles.sceneList}>
              {SCENES.map((scene, index) => <button type="button" aria-current={index === 1 ? 'true' : undefined} key={scene.id}><small>{scene.id}</small><strong>{scene.label}</strong><span>{processing && index === 2 ? '处理中' : scene.status}</span></button>)}
            </div>
          </aside>

          <section className={styles.annotationStage}>
            <div className={styles.stageToolbar}><div><button type="button" aria-pressed="true">选择</button><button type="button">人物框</button><button type="button">物体框</button></div><span>640 × 360 · 第 187 帧</span><button type="button">当前帧 JSON</button></div>
            <div className={styles.videoCanvas}>
              <div className={styles.canvasScene}><span className={styles.counterShape} /><span className={styles.personShape} /><span className={styles.objectShape} /></div>
              <div className={styles.boundingBox} data-kind="person"><span>人物 02 · 94%</span></div>
              <div className={styles.boundingBox} data-kind="object"><span>玻璃罐 07 · 88%</span></div>
              {partial && <div className={styles.canvasNotice}><strong>语义识别未完成</strong><span>检测和追踪结果仍可审核，修复模型后可重新运行。</span></div>}
              {processing && <div className={styles.processingBand}><span /><strong>正在运行 Qwen3-VL 语义识别</strong><small>阶段 4 / 8</small></div>}
            </div>
            <div className={styles.timeline}>
              <div className={styles.timelineRuler}><span>00:05</span><span>00:07</span><span>00:09</span><span>00:11</span></div>
              <div className={styles.timelineTrack}><span className={styles.trackPerson}>人物 02</span><span className={styles.trackObject}>玻璃罐 07</span><i /></div>
            </div>
          </section>

          <aside className={styles.inspector}>
            <div className={styles.inspectorTabs}><button type="button" aria-pressed="true">对象</button><button type="button">场景</button><button type="button">文本</button><button type="button">JSON</button></div>
            <section>
              <div className={styles.inspectorTitle}><span className={styles.entitySwatch} /><div><h2>人物 02</h2><p>Track ID 2 · Person ID 1</p></div></div>
              <label>显示名称<input value="女厨师" readOnly /></label>
              <label>动作<select defaultValue="搅拌"><option>搅拌</option></select></label>
              <label>身份状态<select defaultValue="已锁定"><option>已锁定</option></select></label>
              <div className={styles.confidenceRow}><span>检测置信度</span><strong>94%</strong></div>
              <div className={styles.inspectorActions}><button type="button">分析人物</button><button type="button">转换为物体</button><button type="button" className={styles.dangerText}>删除轨迹</button></div>
            </section>
            <footer>
              <span>审核状态</span>
              <div><button type="button">需要复核</button><button type="button" className={approved ? styles.approvedButton : styles.primaryButton}>{approved ? '已通过' : '通过'}</button><button type="button">拒绝</button></div>
            </footer>
          </aside>
        </div>
        <WorkbenchStateOverlay state={state} />
      </main>
    </PreviewChrome>
  )
}

const TABLE_ROWS = [
  ['usr_01J42P', '林晓雨', '杭州', '2026-07-28', '活跃'],
  ['usr_01J42Q', '周闻川', '上海', '2026-07-29', '活跃'],
  ['usr_01J42R', '沈知遥', '成都', '2026-07-30', '待验证'],
  ['usr_01J42S', '陈观澜', '深圳', '2026-07-30', '活跃'],
  ['usr_01J42T', '许清和', '北京', '2026-07-31', '停用'],
]

function TableWorkspacePreview({ state }: { state: PreviewState }) {
  return (
    <PreviewChrome area="数据合成" compact>
      <main className={styles.tableWorkspace}>
        <header className={styles.tableCommandbar}>
          <div><button type="button">返回项目</button><div><strong>user_profile_features</strong><span>11 列 · 24,680 行</span></div></div>
          <div><button type="button">导入</button><button type="button">导出</button><button type="button">统计</button><button type="button" className={styles.primaryButton}>生成数据</button></div>
        </header>
        <nav className={styles.tableModes} aria-label="数据表工作模式"><button type="button" aria-current="page">数据</button><button type="button">Schema</button><button type="button">生成规则</button><span>Parquet 已同步</span></nav>
        <section className={styles.generationBar}>
          <div><label>生成行数<input value="100" readOnly /></label><label>写入方式<select defaultValue="追加"><option>追加</option></select></label></div>
          <div><span>LLM 已连接</span><span>11 / 11 列已配置</span></div>
        </section>

        {state === 'loading' ? <SkeletonRows count={6} /> : state === 'empty' ? (
          <StatePanel kind="empty" title="表中还没有数据" description="Schema 已包含 11 个字段。生成空记录或调用 LLM 创建第一批数据。" action="生成 100 行" />
        ) : state === 'error' ? (
          <StatePanel kind="error" title="无法读取 Parquet 数据" description="表结构仍然可用，但数据文件加载失败。请检查文件状态后重试。" action="重新加载数据" />
        ) : (
          <div className={styles.dataTableWrap} aria-busy={state === 'processing'}>
            {state === 'processing' && <div className={styles.tableProgress}><span style={{ width: '64%' }} /><strong>正在生成第 64 / 100 行</strong><button type="button">停止</button></div>}
            <table className={styles.dataTable}>
              <thead><tr><th><input type="checkbox" aria-label="选择全部行" /></th><th>user_id <small>ID</small></th><th>name <small>Text</small></th><th>city <small>City</small></th><th>created_at <small>Date</small></th><th>status <small>Text</small></th><th aria-label="行操作" /></tr></thead>
              <tbody>{TABLE_ROWS.map((row, rowIndex) => <tr key={row[0]}><td><input type="checkbox" aria-label={`选择第 ${rowIndex + 1} 行`} /></td>{row.map((cell, cellIndex) => <td key={cell}>{cellIndex === 4 ? <span className={styles.statusLabel} data-tone={cell === '活跃' ? 'success' : cell === '停用' ? 'danger' : 'warning'}>{cell}</span> : cell}</td>)}<td><button type="button">更多</button></td></tr>)}</tbody>
            </table>
            <footer className={styles.tableFooter}><span>已选择 0 行</span><div><button type="button">上一页</button><strong>1 / 494</strong><button type="button">下一页</button></div><select defaultValue="50"><option>每页 50 行</option></select></footer>
          </div>
        )}
      </main>
    </PreviewChrome>
  )
}

export function PreviewRenderer({ previewKey, state }: { previewKey: PreviewKey; state: PreviewState }) {
  if (previewKey === 'home') return <HomePreview state={state} />
  if (previewKey === 'annotation-projects') return <AnnotationProjectsPreview state={state} />
  if (previewKey === 'annotation-project') return <AnnotationProjectPreview state={state} />
  if (previewKey === 'annotation-workbench') return <AnnotationWorkbenchPreview state={state} />
  if (previewKey === 'table-workspace') return <TableWorkspacePreview state={state} />
  if (previewKey === 'data-projects') return <DataProjectsPreview state={state} />
  if (previewKey === 'new-data-project') return <NewDataProjectPreview state={state} />
  if (previewKey === 'data-project-detail') return <DataProjectDetailPreview state={state} />
  if (previewKey === 'new-data-table') return <NewDataTablePreview state={state} />
  if (previewKey === 'shared-settings') return <SharedSettingsPreview state={state} />
  if (previewKey === 'workspace-restore') return <WorkspaceRestorePreview state={state} />
  if (previewKey === 'global-loading') return <SystemStatusPreview kind="loading" />
  if (previewKey === 'global-error') return <SystemStatusPreview kind="error" />
  if (previewKey === 'not-found') return <SystemStatusPreview kind="not-found" />
  if (previewKey === 'video-upload') return <VideoUploadPreview state={state} />
  if (previewKey === 'annotation-export') return <AnnotationExportPreview state={state} />
  if (previewKey === 'identity-manager') return <IdentityManagerPreview state={state} />
  return <TableStatisticsPreview state={state} />
}
