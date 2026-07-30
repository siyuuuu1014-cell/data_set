'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnnotationTimeline } from './AnnotationTimeline'
import { DemoHeader } from './DemoHeader'
import { ObjectInspector } from './ObjectInspector'
import { ProjectSidebar } from './ProjectSidebar'
import { VideoAnnotationStage } from './VideoAnnotationStage'
import { demoDuration, entities as initialEntities, timelineTracks, videos as initialVideos } from './demo-data'
import type { DemoEntity, DemoVideo, DesignScheme } from './types'
import styles from './design-demo.module.css'

type ToastTone = 'success' | 'info' | 'error'

export function DesignDemoWorkspace() {
  const [scheme, setScheme] = useState<DesignScheme>('B')
  const [videos, setVideos] = useState<DemoVideo[]>(initialVideos)
  const [selectedVideoId, setSelectedVideoId] = useState(initialVideos[0].id)
  const [entities, setEntities] = useState<DemoEntity[]>(initialEntities)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(initialEntities[0].id)
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>('s3')
  const [currentTime, setCurrentTime] = useState(43.2)
  const [playing, setPlaying] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [dirty, setDirty] = useState(false)
  const [aiRunning, setAiRunning] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(1)
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>({ message: '演示数据已就绪，所有操作仅保存在当前页面', tone: 'info' })
  const playbackRef = useRef<number | null>(null)
  const currentTimeRef = useRef(currentTime)
  const toastTimerRef = useRef<number | null>(null)

  const selectedVideo = useMemo(
    () => videos.find(video => video.id === selectedVideoId) || videos[0],
    [videos, selectedVideoId],
  )
  const selectedEntity = useMemo(
    () => entities.find(entity => entity.id === selectedEntityId) || null,
    [entities, selectedEntityId],
  )

  const showToast = (message: string, tone: ToastTone = 'success') => {
    setToast({ message, tone })
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600)
  }

  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])

  useEffect(() => {
    if (!playing) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const startedAt = performance.now()
    const initialTime = currentTimeRef.current
    const tick = (now: number) => {
      const nextTime = initialTime + (now - startedAt) / 1000
      if (nextTime >= demoDuration) {
        setCurrentTime(demoDuration)
        setPlaying(false)
        return
      }
      setCurrentTime(reduceMotion ? Math.floor(nextTime * 2) / 2 : nextTime)
      playbackRef.current = window.requestAnimationFrame(tick)
    }
    playbackRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (playbackRef.current) window.cancelAnimationFrame(playbackRef.current)
    }
  }, [playing])

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
  }, [])

  const handleEntityChange = (field: 'category' | 'pose' | 'action' | 'occlusion', value: string | number) => {
    if (!selectedEntityId) return
    setEntities(current => current.map(entity => entity.id === selectedEntityId
      ? { ...entity, attributes: { ...entity.attributes, [field]: value } }
      : entity))
    setDirty(true)
    setSaveState('saving')
  }

  const handleSave = () => {
    if (!dirty) return
    setSaveState('saving')
    window.setTimeout(() => {
      setSaveState('saved')
      setDirty(false)
      setHistoryIndex(current => Math.min(3, current + 1))
      showToast('对象属性已保存，并记录为人工修改')
    }, 650)
  }

  const handleAiAnnotate = () => {
    setAiRunning(true)
    showToast('正在分析当前片段，页面仍可继续浏览', 'info')
    window.setTimeout(() => {
      setAiRunning(false)
      setVideos(current => current.map(video => video.id === selectedVideoId ? { ...video, status: 'ai_annotated', progress: 100, detail: 'AI 预标注完成' } : video))
      showToast('AI 预标注完成：新增 4 个候选对象')
    }, 1200)
  }

  const handleRetry = (videoId: string) => {
    setVideos(current => current.map(video => video.id === videoId ? { ...video, status: 'processing', progress: 8, detail: '正在重新提取关键帧' } : video))
    showToast('已重新加入处理队列', 'info')
  }

  return (
    <main className={`${styles.demoRoot} ${scheme === 'A' ? styles.schemeA : styles.schemeB}`} data-design-scheme={scheme}>
      <a className={styles.skipLink} href="#annotation-stage">跳至标注画面</a>
      <DemoHeader
        saveState={saveState}
        scheme={scheme}
        onSchemeChange={nextScheme => {
          setScheme(nextScheme)
          showToast(
            nextScheme === 'A'
              ? '已切换到方案 A：专业高密度标注工作台'
              : '已切换到方案 B：现代视频智能工作区',
            'info',
          )
        }}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < 3}
        aiRunning={aiRunning}
        onUndo={() => { setHistoryIndex(current => Math.max(0, current - 1)); showToast('已撤销上一步对象修改', 'info') }}
        onRedo={() => { setHistoryIndex(current => Math.min(3, current + 1)); showToast('已恢复对象修改', 'info') }}
        onAiAnnotate={handleAiAnnotate}
        onSubmitReview={() => {
          setVideos(current => current.map(video => video.id === selectedVideoId ? { ...video, status: 'pending_review', detail: '等待审核' } : video))
          showToast('当前视频已提交审核')
        }}
        onPublish={() => showToast('版本 v1.4 已生成，本 Demo 未连接发布服务')}
      />

      <div className={styles.workspaceGrid}>
        <ProjectSidebar
          videos={videos}
          selectedVideoId={selectedVideoId}
          onSelectVideo={videoId => {
            setSelectedVideoId(videoId)
            setCurrentTime(0)
            setPlaying(false)
          }}
          onRetry={handleRetry}
        />

        <div className={styles.centerWorkspace} id="annotation-stage">
          <VideoAnnotationStage
            video={selectedVideo}
            entities={entities}
            selectedEntityId={selectedEntityId}
            currentTime={currentTime}
            duration={demoDuration}
            playing={playing}
            onSelectEntity={setSelectedEntityId}
            onTogglePlay={() => setPlaying(current => !current)}
            onSeek={time => { setCurrentTime(time); setPlaying(false) }}
          />
          <AnnotationTimeline
            tracks={timelineTracks}
            duration={demoDuration}
            currentTime={currentTime}
            selectedSegmentId={selectedSegmentId}
            onSeek={time => { setCurrentTime(Math.max(0, Math.min(demoDuration, time))); setPlaying(false) }}
            onSelectSegment={(id, midpoint) => { setSelectedSegmentId(id); setCurrentTime(midpoint); setPlaying(false) }}
          />
        </div>

        <ObjectInspector
          entity={selectedEntity}
          dirty={dirty}
          onChange={handleEntityChange}
          onSave={handleSave}
          onClear={() => setSelectedEntityId(null)}
        />
      </div>

      {aiRunning ? (
        <div className={styles.aiProgress} role="status">
          <span className={styles.aiSpinner} />
          <div><strong>AI 正在预标注</strong><span>对象检测 · Track 关联 · 语义补全</span></div>
          <span className={styles.aiProgressBar}><i /></span>
        </div>
      ) : null}

      {toast ? (
        <div className={`${styles.toast} ${styles[`toast${toast.tone}`]}`} role="status" aria-live="polite">
          <span>{toast.tone === 'error' ? '!' : '✓'}</span>
          {toast.message}
          <button type="button" onClick={() => setToast(null)} aria-label="关闭通知">×</button>
        </div>
      ) : null}
    </main>
  )
}
