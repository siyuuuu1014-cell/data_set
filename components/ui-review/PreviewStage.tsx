'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { PreviewRenderer } from './previews'
import { SlidingControl } from './SlidingControl'
import { STATE_LABELS, type PreviewState, type ReviewPage } from './review-data'
import styles from './ui-review.module.css'

type Viewport = 'wide' | 'desktop' | 'narrow'

const VIEWPORT_LABELS: Record<Viewport, string> = {
  wide: '宽屏',
  desktop: '桌面',
  narrow: '窄屏',
}

export function PreviewStage({ page }: { page: ReviewPage }) {
  const [previewState, setPreviewState] = useState<PreviewState>('normal')
  const [viewport, setViewport] = useState<Viewport>('wide')
  const stateOptions = useMemo(() => page.states, [page.states])

  return (
    <main className={styles.stageRoot}>
      <header className={styles.stageHeader}>
        <div className={styles.stageIdentity}>
          <Link href="/ui-review" className={styles.backLink}>返回审查首页</Link>
          <div>
            <span>{page.module}</span>
            <h1>{page.name}</h1>
            <code>{page.formalRoute}</code>
          </div>
        </div>

        <div className={styles.stageControls}>
          <fieldset>
            <legend>业务状态</legend>
            <SlidingControl
              value={previewState}
              options={stateOptions.map(state => ({ value: state, label: STATE_LABELS[state] }))}
              onChange={setPreviewState}
              label="切换业务状态"
            />
          </fieldset>
          <fieldset>
            <legend>预览宽度</legend>
            <SlidingControl
              value={viewport}
              options={(Object.keys(VIEWPORT_LABELS) as Viewport[]).map(option => ({ value: option, label: VIEWPORT_LABELS[option] }))}
              onChange={setViewport}
              label="切换预览宽度"
            />
          </fieldset>
        </div>
      </header>

      <section className={styles.stageWorkspace}>
        <div className={styles.previewFrame} data-viewport={viewport}>
          <PreviewRenderer previewKey={page.key} state={previewState} />
        </div>
      </section>

      <aside className={styles.decisionPanel}>
        <div>
          <span>优化方式</span>
          <strong>{page.mode}</strong>
        </div>
        <div>
          <span>原页面主要问题</span>
          <p>{page.problem}</p>
        </div>
        <div>
          <span>布局与交互变化</span>
          <p>{page.improvement}</p>
        </div>
        <div>
          <span>需要重点审查</span>
          <p>{page.reviewFocus}</p>
        </div>
        <div>
          <span>参与 Skill</span>
          <p>{page.skills.join(' · ')}</p>
        </div>
      </aside>
    </main>
  )
}
