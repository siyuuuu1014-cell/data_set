'use client'

import { useState } from 'react'
import { PreviewChrome, SkeletonRows, StatePanel } from './preview-primitives'
import type { PreviewState } from './review-data'
import { SlidingControl } from './SlidingControl'
import styles from './ui-review.module.css'

type SettingsSection = 'synthetic' | 'semantic' | 'deployment'

const SETTINGS_SECTIONS = [
  { value: 'synthetic', label: '合成数据 LLM', description: '文本与代码生成' },
  { value: 'semantic', label: '视频语义模型', description: '本地或远程视觉模型' },
  { value: 'deployment', label: '视频部署模式', description: '标准或完整增强' },
] satisfies { value: SettingsSection; label: string; description: string }[]

function ConnectionNotice({ state }: { state: PreviewState }) {
  if (state === 'processing') return <p className={styles.connectionNotice} data-tone="info" role="status">正在测试模型端点，当前配置尚未保存。</p>
  if (state === 'success') return <p className={styles.connectionNotice} data-tone="success" role="status">连接测试成功，配置已保存到本地服务。</p>
  return null
}

function SyntheticSettings({ state }: { state: PreviewState }) {
  const isEmpty = state === 'empty'
  const [provider, setProvider] = useState<'deepseek' | 'openai' | 'ollama'>('deepseek')
  const [format, setFormat] = useState<'anthropic' | 'openai'>('anthropic')

  return (
    <section className={styles.settingsSection}>
      <header><div><h2>合成数据 · LLM 配置</h2><p>用于文本字段与生成器代码。API Key 仅保存在本地服务端。</p></div><span className={styles.statusLabel} data-tone={isEmpty ? 'warning' : 'success'}>{isEmpty ? '尚未配置' : '已连接'}</span></header>
      <div className={styles.settingsFormGrid}>
        <fieldset className={styles.settingsWideField}>
          <legend>服务商预设</legend>
          <SlidingControl
            value={provider}
            options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'openai', label: 'OpenAI' }, { value: 'ollama', label: 'Ollama' }]}
            onChange={setProvider}
            label="选择合成数据模型服务商"
          />
        </fieldset>
        <fieldset className={styles.settingsWideField}>
          <legend>API 格式</legend>
          <SlidingControl
            value={format}
            options={[{ value: 'anthropic', label: 'Anthropic 兼容' }, { value: 'openai', label: 'OpenAI 兼容' }]}
            onChange={setFormat}
            label="选择 API 格式"
          />
        </fieldset>
        <label><span>API Key</span><input type="password" value={isEmpty ? '' : '••••••••••••••••'} placeholder="sk-..." readOnly /><small>{isEmpty ? '尚未保存密钥，连接测试将不可用。' : '已保存；保持不变时无需再次输入。'}</small></label>
        <label><span>模型</span><input value={provider === 'openai' ? 'gpt-4o' : provider === 'ollama' ? 'llama3' : 'deepseek-chat'} readOnly /></label>
        <label className={styles.settingsWideField}><span>Base URL</span><input value={provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.deepseek.com/anthropic'} readOnly /><small>请求地址将根据所选格式追加对应端点。</small></label>
      </div>
      <ConnectionNotice state={state} />
      <footer className={styles.settingsActions}><button type="button" disabled={isEmpty || state === 'processing'}>{state === 'processing' ? '正在测试…' : '测试连接'}</button><button type="button" className={styles.primaryButton}>保存配置</button></footer>
    </section>
  )
}

function SemanticSettings({ state }: { state: PreviewState }) {
  const [mode, setMode] = useState<'local' | 'remote'>('local')
  return (
    <section className={styles.settingsSection}>
      <header><div><h2>视频标注 · 语义模型</h2><p>只替换视频语义阶段，其余检测、追踪和语音模型保持本地运行。</p></div><span className={styles.statusLabel} data-tone="success">本地 Qwen</span></header>
      <fieldset className={styles.settingsChoiceBlock}>
        <legend>运行方式</legend>
        <SlidingControl
          value={mode}
          options={[{ value: 'local', label: '本地 Qwen', description: '不发送关键帧' }, { value: 'remote', label: '远程多模态 API', description: '最多发送 3 张关键帧' }]}
          onChange={setMode}
          label="选择视频语义模型运行方式"
        />
      </fieldset>
      {mode === 'local' ? (
        <div className={styles.settingsDefinition}><div><span>模型来源</span><strong>Worker 本地模型</strong></div><div><span>数据边界</span><strong>关键帧不离开设备</strong></div><div><span>显存占用</span><strong>由当前 Worker 调度</strong></div></div>
      ) : (
        <div className={styles.settingsFormGrid}><label className={styles.settingsWideField}><span>视觉模型</span><input value="qwen-vl-max" readOnly /></label><label className={styles.settingsWideField}><span>远程 API Key</span><input type="password" placeholder="可选，本地服务可留空" readOnly /></label><p className={`${styles.connectionNotice} ${styles.settingsWideField}`} data-tone="warning">远程模式会将片段关键帧发送给第三方服务。启用前需确认数据权限、费用和服务条款。</p></div>
      )}
      <ConnectionNotice state={state} />
      <footer className={styles.settingsActions}><button type="button" disabled={state === 'processing'}>{state === 'processing' ? '正在测试…' : '测试视觉连接'}</button><button type="button" className={styles.primaryButton}>保存语义配置</button></footer>
    </section>
  )
}

function DeploymentSettings({ state }: { state: PreviewState }) {
  const [mode, setMode] = useState<'standard' | 'enhanced'>('standard')
  return (
    <section className={styles.settingsSection}>
      <header><div><h2>视频标注 · 部署模式</h2><p>标准模式无需授权；完整增强模式启用受限的细粒度定位模型。</p></div><span className={styles.statusLabel} data-tone={mode === 'standard' ? 'success' : 'warning'}>{mode === 'standard' ? '标准模式' : '需要授权'}</span></header>
      <fieldset className={styles.settingsChoiceBlock}>
        <legend>Pipeline 能力</legend>
        <SlidingControl
          value={mode}
          options={[{ value: 'standard', label: '标准模式', description: '公开模型，可直接运行' }, { value: 'enhanced', label: '完整增强', description: '启用 LocateAnything-3B' }]}
          onChange={setMode}
          label="选择视频标注部署模式"
        />
      </fieldset>
      {mode === 'standard' ? (
        <div className={styles.settingsDefinition}><div><span>授权</span><strong>无需 Hugging Face Token</strong></div><div><span>任务阻塞</span><strong>受限模型不可用时继续运行</strong></div><div><span>适用场景</span><strong>默认本地标注流程</strong></div></div>
      ) : (
        <div className={styles.enhancedSetup}><div><span>LocateAnything-3B</span><strong>尚未连接 Hugging Face</strong><small>Token 仅用于本次授权请求，不会由前端保存或回显。</small></div><label><span>Hugging Face Token</span><input type="password" placeholder="hf_..." readOnly /></label><button type="button" className={styles.primaryButton}>连接并检查模型</button></div>
      )}
      <ConnectionNotice state={state} />
    </section>
  )
}

export function SharedSettingsPreview({ state }: { state: PreviewState }) {
  const [section, setSection] = useState<SettingsSection>('synthetic')
  const current = SETTINGS_SECTIONS.find(item => item.value === section) ?? SETTINGS_SECTIONS[0]

  return (
    <PreviewChrome area="系统设置" compact>
      <main className={styles.settingsPreview}>
        <header className={styles.supportPageHeader}><div><h1>共享设置</h1><p>合成数据和视频标注在这里连接各自的模型服务。</p></div><span className={styles.serviceStatus}><i />本地配置可用</span></header>
        <div className={styles.settingsWorkbench}>
          <aside className={styles.settingsRail}>
            <div><strong>配置目录</strong><small>切换服务不会丢失未保存输入</small></div>
            <SlidingControl value={section} options={SETTINGS_SECTIONS} onChange={setSection} label="共享设置分类" orientation="vertical" />
            <dl><div><dt>合成数据</dt><dd>{state === 'empty' ? '未配置' : '可用'}</dd></div><div><dt>视频语义</dt><dd>本地</dd></div><div><dt>部署模式</dt><dd>标准</dd></div></dl>
          </aside>
          <section className={styles.settingsCanvas}>
            <header className={styles.settingsCanvasBar}><div><span>当前配置</span><strong>{current.label}</strong></div><small>{current.description} · 悬停预览位置，点击后切换</small></header>
            {state === 'loading' ? <div className={styles.settingsLoading}><SkeletonRows count={5} /></div> : state === 'error' ? <StatePanel kind="error" title="无法读取共享配置" description="本地配置服务没有响应。已有密钥和模型设置未被修改。" action="重新读取" /> : section === 'synthetic' ? <SyntheticSettings state={state} /> : section === 'semantic' ? <SemanticSettings state={state} /> : <DeploymentSettings state={state} />}
          </section>
        </div>
      </main>
    </PreviewChrome>
  )
}

export function WorkspaceRestorePreview({ state }: { state: PreviewState }) {
  const complete = state === 'success'
  const fallback = state === 'partial'
  const failed = state === 'error'
  const scanning = state === 'normal' || state === 'loading' || state === 'processing'

  return (
    <PreviewChrome area="工作区入口" compact>
      <main className={styles.restorePreview} aria-busy={scanning}>
        <section className={styles.restoreNarrative}>
          <span className={styles.restoreSignal} data-state={failed ? 'error' : complete ? 'success' : fallback ? 'partial' : 'processing'} aria-hidden="true"><i /></span>
          <div><h1>{failed ? '工作区恢复未完成' : complete ? '工作区已恢复' : fallback ? '已完成基础恢复' : '正在恢复工作区'}</h1><p>{failed ? '浏览器项目数据无法读取。请保留当前页面并检查本地存储。' : complete ? '浏览器项目数据已与本地视频任务合并，可以返回项目列表。' : fallback ? '本地项目数据已保留，但视频任务扫描暂时不可用。' : '正在合并浏览器项目数据与本地视频标注任务。'}</p></div>
          {complete && <button type="button" className={styles.primaryButton}>进入项目列表</button>}
        </section>
        <div className={styles.restoreWorkspace}>
          <ol className={styles.restoreSteps} aria-live="polite">
            <li data-status={failed ? 'error' : 'done'}><span>1</span><div><strong>读取浏览器项目数据</strong><small>{failed ? '数据格式无法解析' : '项目索引与表结构已保留'}</small></div></li>
            <li data-status={complete ? 'done' : fallback ? 'partial' : failed ? 'waiting' : 'active'}><span>2</span><div><strong>扫描视频标注任务</strong><small>{complete ? '本地任务已合并' : fallback ? '服务不可用，已跳过' : failed ? '等待基础数据恢复' : '正在访问任务目录'}</small></div></li>
            <li data-status={complete ? 'active' : 'waiting'}><span>3</span><div><strong>打开项目列表</strong><small>{complete ? '即将自动跳转' : '完成扫描后继续'}</small></div></li>
          </ol>
          <aside className={styles.restoreSummary}>
            <div><span>已保留内容</span><strong>合成数据项目</strong><small>clickhouse · 11 张表</small></div>
            <div><span>正在确认</span><strong>视频标注任务</strong><small>{complete ? '扫描完成' : fallback ? '等待服务恢复' : '从本地任务目录读取'}</small></div>
            {fallback && <p role="status">视频任务扫描失败不会删除已有浏览器数据。稍后可从恢复页再次扫描。</p>}
            {failed && <div className={styles.restoreRecovery} role="alert"><strong>不要清除浏览器数据</strong><span>先重试读取；如果问题持续，再返回首页检查本地服务。</span><button type="button">重新读取</button><button type="button">返回首页</button></div>}
          </aside>
        </div>
      </main>
    </PreviewChrome>
  )
}

export function SystemStatusPreview({ kind }: { kind: 'loading' | 'error' | 'not-found' }) {
  const loading = kind === 'loading'
  const error = kind === 'error'
  return (
    <main className={styles.systemStatusPreview} data-kind={kind} aria-busy={loading}>
      <section>
        <div className={styles.systemStatusMark} aria-hidden="true">{loading ? <i /> : error ? '!' : '404'}</div>
        <div className={styles.systemStatusCopy}>
          <h1>{loading ? '正在准备工作区' : error ? '这个页面未能正常加载' : '页面或本地内容不存在'}</h1>
          <p>{loading ? '正在读取页面数据、配置状态和本地服务连接，请稍候。' : error ? '现有项目与审核结果没有被修改。你可以重试，或检查本地服务后返回首页。' : '地址可能已经变化，或者对应的项目、数据表或标注任务已从当前浏览器中移除。'}</p>
        </div>
        {loading ? <div className={styles.systemLoadSteps}><span data-active>读取本地数据</span><span>确认服务状态</span><span>打开工作区</span></div> : <div className={styles.systemStatusActions}>{error && <button type="button">重新加载</button>}<button type="button">返回首页</button>{error ? <button type="button">检查本地服务</button> : <><button type="button">数据合成</button><button type="button">视频标注</button></>}</div>}
      </section>
    </main>
  )
}
