import { DemoIcon } from './DemoIcon'
import type { DesignScheme } from './types'
import styles from './design-demo.module.css'

interface DemoHeaderProps {
  saveState: 'saved' | 'saving' | 'error'
  canUndo: boolean
  canRedo: boolean
  aiRunning: boolean
  scheme: DesignScheme
  onSchemeChange: (scheme: DesignScheme) => void
  onUndo: () => void
  onRedo: () => void
  onAiAnnotate: () => void
  onSubmitReview: () => void
  onPublish: () => void
}

export function DemoHeader({
  saveState,
  canUndo,
  canRedo,
  aiRunning,
  scheme,
  onSchemeChange,
  onUndo,
  onRedo,
  onAiAnnotate,
  onSubmitReview,
  onPublish,
}: DemoHeaderProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.brandBlock}>
        <span className={styles.brandMark}>N</span>
        <div className={styles.brandCopy}>
          <strong>Nuwa</strong>
          <span>Video Intelligence</span>
        </div>
      </div>

      <div className={styles.projectTitle}>
        <span className={styles.breadcrumb}>视频标注 / 城市行为数据集</span>
        <strong>街景行为识别 · Batch 04</strong>
      </div>

      <div className={styles.schemeSwitcher} aria-label="界面方案">
        <span className={styles.schemeLabel}>方案对比</span>
        <div className={styles.schemeOptions}>
          <button
            className={`${styles.schemeOption} ${scheme === 'A' ? styles.schemeOptionActive : ''}`}
            type="button"
            aria-pressed={scheme === 'A'}
            onClick={() => onSchemeChange('A')}
          >
            <strong>A</strong>
            <span>专业工作台</span>
          </button>
          <button
            className={`${styles.schemeOption} ${scheme === 'B' ? styles.schemeOptionActive : ''}`}
            type="button"
            aria-pressed={scheme === 'B'}
            onClick={() => onSchemeChange('B')}
          >
            <strong>B</strong>
            <span>视频智能</span>
          </button>
        </div>
      </div>

      <div className={styles.headerActions}>
        <span className={`${styles.saveState} ${styles[saveState]}`} aria-live="polite">
          <span className={styles.stateDot} />
          {saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败' : '已保存 14:32'}
        </span>
        <div className={styles.actionPair} aria-label="历史操作">
          <button className={styles.iconButton} type="button" onClick={onUndo} disabled={!canUndo} aria-label="撤销">
            <DemoIcon name="undo" />
          </button>
          <button className={styles.iconButton} type="button" onClick={onRedo} disabled={!canRedo} aria-label="重做">
            <DemoIcon name="redo" />
          </button>
        </div>
        <button className={`${styles.secondaryButton} ${styles.aiButton}`} type="button" onClick={onAiAnnotate} disabled={aiRunning}>
          <DemoIcon name="spark" />
          {aiRunning ? 'AI 分析中' : 'AI 预标注'}
        </button>
        <button className={`${styles.secondaryButton} ${styles.reviewButton}`} type="button" onClick={onSubmitReview}>
          <DemoIcon name="review" />
          提交审核
        </button>
        <button className={`${styles.primaryButton} ${styles.publishButton}`} type="button" onClick={onPublish}>
          <DemoIcon name="publish" />
          发布版本
        </button>
      </div>
    </header>
  )
}
