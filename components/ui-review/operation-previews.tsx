'use client'

import { useState, type CSSProperties } from 'react'
import { PreviewChrome, SkeletonRows } from './preview-primitives'
import type { PreviewState } from './review-data'
import { SlidingControl } from './SlidingControl'
import styles from './ui-review.module.css'

const VIDEO_FILES = [
  { name: '苹果太太的厨房-玫瑰酱.mp4', size: '284 MB', duration: '01:14' },
  { name: '春日来信.mp4', size: '196 MB', duration: '02:12' },
  { name: '成为你们.mp4', size: '318 MB', duration: '01:48' },
]

export function VideoUploadPreview({ state }: { state: PreviewState }) {
  const empty = state === 'empty'
  const processing = state === 'processing'
  const failed = state === 'error'
  const success = state === 'success'

  return (
    <PreviewChrome area="视频标注" compact>
      <main className={styles.operationScene}>
        <div className={styles.operationContext}><span>标注项目 test</span><strong>10 个视频 · 3 项需要复核</strong></div>
        <div className={styles.operationBackdrop}>
          <section className={styles.operationDialog} role="dialog" aria-modal="true" aria-labelledby="review-upload-title" aria-busy={processing}>
            <header className={styles.operationDialogHeader}><div><h1 id="review-upload-title">添加视频</h1><p>选择本地视频后，Nuwa 会为每个文件创建独立处理任务。</p></div><button type="button" aria-label="关闭添加视频对话框">关闭</button></header>
            {empty ? (
              <button type="button" className={styles.uploadDropzone}><strong>拖放视频到这里</strong><span>或点击选择 MP4、MOV、AVI、MKV、WebM 文件</span></button>
            ) : (
              <div className={styles.uploadQueue}>
                <div className={styles.uploadQueueHeading}><span>{success ? '已完成 3 个文件' : failed ? '2 个可上传，1 个需要处理' : '已选择 3 个文件'}</span><button type="button" disabled={processing}>继续添加</button></div>
                {VIDEO_FILES.map((file, index) => {
                  const fileFailed = failed && index === 1
                  const progress = processing ? [100, 64, 0][index] : success ? 100 : 0
                  return <article key={file.name} data-status={fileFailed ? 'error' : success ? 'success' : processing ? 'processing' : 'ready'}>
                    <span className={styles.fileType}>MP4</span>
                    <div><strong>{file.name}</strong><small>{file.size} · {file.duration}{fileFailed ? ' · 文件读取失败，请重新选择' : ''}</small>{processing && <i aria-hidden="true"><b style={{ transform: `scaleX(${progress / 100})` }} /></i>}</div>
                    <span>{fileFailed ? '需要重选' : success ? '已加入项目' : processing ? `${progress}%` : '等待上传'}</span>
                    <button type="button" aria-label={`${fileFailed ? '重新选择' : '移除'} ${file.name}`} disabled={processing || success}>{fileFailed ? '重选' : '移除'}</button>
                  </article>
                })}
              </div>
            )}
            {failed && <p className={styles.operationError} role="alert">“春日来信.mp4”无法读取。其他文件仍保留在队列中。</p>}
            {success && <p className={styles.operationSuccess} role="status">3 个视频任务已创建，Pipeline 将按本地 Worker 队列处理。</p>}
            <footer className={styles.operationDialogActions}><button type="button" disabled={processing}>取消</button><button type="button" className={styles.primaryButton} disabled={empty || failed || processing || success}>{processing ? '正在上传…' : success ? '上传完成' : '上传 3 个视频'}</button></footer>
          </section>
        </div>
      </main>
    </PreviewChrome>
  )
}

type ExportFormat = 'json' | 'yolo' | 'coco'

const EXPORT_FORMATS = [
  { value: 'json', label: 'Custom JSON' },
  { value: 'yolo', label: 'YOLO ZIP' },
  { value: 'coco', label: 'COCO JSON' },
] satisfies { value: ExportFormat; label: string }[]

const EXPORT_DETAIL: Record<ExportFormat, { description: string; output: string; includes: string }> = {
  json: { description: '保留完整标注结构，并生成视频级语义摘要。', output: 'annotation.json', includes: '片段、实体、场景、事件与视频摘要' },
  yolo: { description: '导出训练可用的图像与标签文本压缩包。', output: 'dataset-yolo.zip', includes: '关键帧、labels/*.txt 与数据集配置' },
  coco: { description: '标准目标检测结构，兼容多数训练框架。', output: 'annotations-coco.json', includes: 'images、annotations 与 categories' },
}

export function AnnotationExportPreview({ state }: { state: PreviewState }) {
  const [format, setFormat] = useState<ExportFormat>('json')
  const [includeRecognition, setIncludeRecognition] = useState(false)
  const busy = state === 'processing'
  const detail = EXPORT_DETAIL[format]

  return (
    <PreviewChrome area="视频标注" compact>
      <main className={styles.operationScene}>
        <div className={styles.operationContext}><span>苹果太太的厨房-玫瑰酱.mp4</span><strong>26 个片段 · 人工审核已保存</strong></div>
        <div className={styles.operationBackdrop}>
          <section className={styles.operationDialog} role="dialog" aria-modal="true" aria-labelledby="review-export-title" aria-busy={busy}>
            <header className={styles.operationDialogHeader}><div><h1 id="review-export-title">导出标注数据</h1><p>选择下游工具需要的格式，并确认最终包含的内容。</p></div><button type="button" aria-label="关闭导出对话框">关闭</button></header>
            <fieldset className={styles.exportFormat}><legend>导出格式</legend><SlidingControl value={format} options={EXPORT_FORMATS} onChange={setFormat} label="选择标注导出格式" /></fieldset>
            <div className={styles.exportSummary}>
              <div><span>输出文件</span><strong>{detail.output}</strong></div>
              <div><span>包含内容</span><strong>{detail.includes}</strong></div>
              <p>{detail.description}</p>
            </div>
            {format === 'json' && <label className={styles.exportRecognition}><input type="checkbox" checked={includeRecognition} onChange={event => setIncludeRecognition(event.target.checked)} disabled={busy} /><span><strong>包含已修正的 OCR 与语音文本</strong><small>加入文字对象和 speechTranscript；运行诊断与临时帧仍不会导出。</small></span></label>}
            {state === 'error' && <p className={styles.operationError} role="alert">导出文件写入失败。审核结果没有受到影响，请检查本地目录后重试。</p>}
            {state === 'success' && <p className={styles.operationSuccess} role="status">{detail.output} 已生成并开始下载。</p>}
            {busy && <p className={styles.operationProgress} role="status"><i><b /></i><span>正在整理片段、关键帧与人工修正内容…</span></p>}
            <footer className={styles.operationDialogActions}><button type="button" disabled={busy}>取消</button><button type="button" className={styles.primaryButton} disabled={busy}>{busy ? '正在导出…' : `导出 ${EXPORT_FORMATS.find(item => item.value === format)?.label}`}</button></footer>
          </section>
        </div>
      </main>
    </PreviewChrome>
  )
}

const IDENTITIES = [
  { id: 'person_01', segments: '片段 01–08、12–18', tracks: 14, locked: true },
  { id: 'person_02', segments: '片段 03–11', tracks: 8, locked: false },
  { id: 'person_03', segments: '片段 19–26', tracks: 7, locked: false },
]

export function IdentityManagerPreview({ state }: { state: PreviewState }) {
  const [selected, setSelected] = useState('person_03')
  const [selectedMergeTarget, setSelectedMergeTarget] = useState('person_01')
  const current = IDENTITIES.find(identity => identity.id === selected) ?? IDENTITIES[0]
  const mergeTargets = IDENTITIES.filter(identity => identity.id !== current.id)
  const mergeTarget = mergeTargets.some(identity => identity.id === selectedMergeTarget)
    ? selectedMergeTarget
    : mergeTargets[0].id

  return (
    <PreviewChrome area="视频标注" compact>
      <main className={styles.identityPreview} aria-busy={state === 'processing'}>
        <header className={styles.operationPageHeader}><div><h1>人物身份管理</h1><p>人工合并、拆分和锁定会在模型重新运行后继续生效。</p></div><button type="button">返回标注工作台</button></header>
        {state === 'loading' ? <div className={styles.operationLoading}><SkeletonRows count={5} /></div> : state === 'empty' ? <section className={styles.operationState}><h2>当前视频中没有人物身份</h2><p>完成检测与追踪后，跨片段人物会显示在这里。</p><button type="button">返回运行 Pipeline</button></section> : state === 'error' ? <section className={styles.operationState} role="alert"><h2>无法读取人物身份</h2><p>身份更新服务没有响应，现有人工决定未被修改。</p><button type="button">重新读取</button></section> : (
          <div className={styles.identityWorkspace}>
            <aside className={styles.identityDirectory}>
              <div className={styles.identityDirectoryHeader}><strong>视频身份</strong><span>{IDENTITIES.length} 人</span></div>
              <div className={styles.identityList} role="tablist" aria-label="视频人物身份">
                {IDENTITIES.map(identity => <button type="button" role="tab" id={`identity-tab-${identity.id}`} aria-controls="identity-decision-panel" aria-selected={selected === identity.id} key={identity.id} onClick={() => setSelected(identity.id)}><strong>{identity.id}</strong><small>{identity.segments}</small><span>{identity.locked ? '已锁定' : `${identity.tracks} 条轨迹`}</span></button>)}
              </div>
            </aside>
            <section className={styles.identityDecision} id="identity-decision-panel" role="tabpanel" aria-labelledby={`identity-tab-${current.id}`}>
              <header><div><span>当前身份</span><h2>{current.id}</h2><p>{current.segments} · {current.tracks} 条跨帧轨迹</p></div><button type="button">{current.locked ? '解除锁定' : '锁定身份'}</button></header>
              <div className={styles.identityActionBlock}><div><h3>合并身份</h3><p>把误分为两个身份的轨迹归入同一个人。合并方向会被永久记录。</p></div><div className={styles.identityMergeFlow}><div className={styles.identitySource}><span>来源</span><strong>{current.id}</strong></div><span>合并到</span><label><span>目标</span><select value={mergeTarget} onChange={event => setSelectedMergeTarget(event.target.value)}>{mergeTargets.map(identity => <option key={identity.id} value={identity.id}>{identity.id}</option>)}</select></label></div><div className={styles.identityCommit}><p><strong>{current.id}</strong> 的轨迹将归入 <strong>{mergeTarget}</strong>；原身份不再单独显示。</p><button type="button" className={styles.primaryButton} disabled={state === 'processing'}>{state === 'processing' ? '正在合并…' : '确认合并'}</button></div></div>
              <div className={styles.identityActionBlock}><div><h3>从当前片段拆分</h3><p>将片段 20 的 Track 3 建立为新的锁定身份，不影响其他片段。</p></div><button type="button" disabled={state === 'processing'}>拆分为新身份</button></div>
              {state === 'success' && <p className={styles.operationSuccess} role="status">身份决定已保存，模型重新运行时会自动重新应用。</p>}
            </section>
          </div>
        )}
      </main>
    </PreviewChrome>
  )
}

type StatField = 'user_id' | 'full_name' | 'city' | 'created_at' | 'status'

const STAT_FIELDS = [
  { value: 'user_id', label: 'user_id', description: 'ID · 唯一标识' },
  { value: 'full_name', label: 'full_name', description: 'Text · 中文姓名' },
  { value: 'city', label: 'city', description: 'City · 城市分布' },
  { value: 'created_at', label: 'created_at', description: 'Date · 最近一年' },
  { value: 'status', label: 'status', description: 'Text · 3 个枚举' },
] satisfies { value: StatField; label: string; description: string }[]

const FIELD_STATS: Record<StatField, { metrics: [string, string][]; distribution: [string, number, string][] }> = {
  user_id: { metrics: [['总行数', '24,680'], ['唯一值', '24,680'], ['重复值', '0'], ['空值', '0']], distribution: [['唯一率', 1, '100%']] },
  full_name: { metrics: [['总行数', '24,680'], ['唯一值', '21,342'], ['平均长度', '3.1 字'], ['空值', '0']], distribution: [['2 字', .18, '18%'], ['3 字', .69, '69%'], ['4 字', .13, '13%']] },
  city: { metrics: [['总行数', '24,680'], ['城市', '34'], ['省份', '19'], ['空值', '0']], distribution: [['广东', .82, '4,936'], ['浙江', .66, '3,972'], ['江苏', .54, '3,248'], ['四川', .41, '2,468']] },
  created_at: { metrics: [['总行数', '24,680'], ['最早', '2025-08-01'], ['最晚', '2026-07-31'], ['跨度', '365 天']], distribution: [['2026-04', .72, '2,188'], ['2026-05', .88, '2,674'], ['2026-06', .95, '2,892'], ['2026-07', 1, '3,046']] },
  status: { metrics: [['总行数', '24,680'], ['枚举值', '3'], ['最高占比', '68.4%'], ['空值', '0']], distribution: [['活跃', 1, '16,881'], ['待验证', .31, '5,218'], ['停用', .15, '2,581']] },
}

export function TableStatisticsPreview({ state }: { state: PreviewState }) {
  const [field, setField] = useState<StatField>('city')
  const current = STAT_FIELDS.find(item => item.value === field) ?? STAT_FIELDS[0]
  const stats = FIELD_STATS[field]

  return (
    <PreviewChrome area="数据合成" compact>
      <main className={styles.statisticsPreview}>
        <header className={styles.operationPageHeader}><div><h1>字段统计</h1><p>user_profile_features · 24,680 行 · 基于当前本地数据</p></div><button type="button">关闭统计</button></header>
        {state === 'loading' ? <div className={styles.operationLoading}><SkeletonRows count={5} /></div> : state === 'empty' ? <section className={styles.operationState}><h2>没有可统计的数据</h2><p>表结构已经保存。生成或导入数据后即可查看字段分布。</p><button type="button">生成数据</button></section> : state === 'error' ? <section className={styles.operationState} role="alert"><h2>统计计算未完成</h2><p>无法读取当前 Parquet 数据。Schema 和现有文件没有被修改。</p><button type="button">重新计算</button></section> : (
          <div className={styles.statisticsWorkspace}>
            <aside className={styles.statisticsDirectory}>
              <div className={styles.statisticsDirectoryHeader}><strong>字段</strong><span>5 / 11</span></div>
              <div className={styles.statisticsFieldList} role="tablist" aria-label="选择统计字段">
                {STAT_FIELDS.map(item => <button type="button" role="tab" id={`stat-tab-${item.value}`} aria-controls="stat-field-panel" aria-selected={field === item.value} key={item.value} onClick={() => setField(item.value)}><strong>{item.label}</strong><small>{item.description}</small></button>)}
              </div>
              <button type="button">显示全部 11 个字段</button>
            </aside>
            <section className={styles.statisticsCanvas} id="stat-field-panel" role="tabpanel" aria-labelledby={`stat-tab-${field}`}>
              <header><div><span>{current.description}</span><h2>{current.label}</h2></div><button type="button">复制摘要</button></header>
              <dl className={styles.statisticsMetrics}>{stats.metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              <div className={styles.statisticsDistribution}><div><h3>分布</h3><p>按当前字段类型显示最有用的统计维度。</p></div>{stats.distribution.map(([label, scale, value]) => <div className={styles.statBarRow} key={label}><span>{label}</span><i><b style={{ '--bar-scale': scale } as CSSProperties} /></i><strong>{value}</strong></div>)}</div>
              <footer><span>统计基于当前表中全部 24,680 行</span><button type="button">导出统计 JSON</button></footer>
            </section>
          </div>
        )}
      </main>
    </PreviewChrome>
  )
}
