import { DemoIcon } from './DemoIcon'
import { MockVideoFrame } from './MockVideoFrame'
import type { DemoEntity, DemoVideo } from './types'
import styles from './design-demo.module.css'

interface VideoAnnotationStageProps {
  video: DemoVideo
  entities: DemoEntity[]
  selectedEntityId: string | null
  currentTime: number
  duration: number
  playing: boolean
  onSelectEntity: (id: string) => void
  onTogglePlay: () => void
  onSeek: (time: number) => void
}

export function formatTime(seconds: number, precise = false) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(precise ? 2 : 0).padStart(precise ? 5 : 2, '0')}`
}

export function VideoAnnotationStage({
  video,
  entities,
  selectedEntityId,
  currentTime,
  duration,
  playing,
  onSelectEntity,
  onTogglePlay,
  onSeek,
}: VideoAnnotationStageProps) {
  return (
    <section className={styles.stagePanel}>
      <div className={styles.panelHeader}>
        <div>
          <span className={styles.panelKicker}>当前视频</span>
          <strong>{video.name}</strong>
        </div>
        <div className={styles.stageTools}>
          <span className={styles.frameCounter}>FRAME {Math.round(currentTime * 30)}</span>
          <button className={styles.toolButton} type="button" aria-label="缩小"><DemoIcon name="zoomOut" /></button>
          <span className={styles.zoomValue}>78%</span>
          <button className={styles.toolButton} type="button" aria-label="放大"><DemoIcon name="zoomIn" /></button>
          <button className={`${styles.toolButton} ${styles.toolButtonActive}`} type="button" aria-label="边界框工具"><DemoIcon name="box" /></button>
        </div>
      </div>

      <div className={styles.stageCanvas}>
        <MockVideoFrame entities={entities} selectedEntityId={selectedEntityId} onSelectEntity={onSelectEntity} />
      </div>

      <div className={styles.transport}>
        <button className={styles.playButton} type="button" onClick={onTogglePlay} aria-label={playing ? '暂停' : '播放'}>
          <DemoIcon name={playing ? 'pause' : 'play'} />
        </button>
        <span className={styles.timeReadout}>{formatTime(currentTime, true)}</span>
        <input
          className={styles.scrubber}
          type="range"
          min={0}
          max={duration}
          step={1 / 30}
          value={currentTime}
          onChange={event => onSeek(Number(event.target.value))}
          aria-label="视频播放位置"
          style={{ '--progress': `${(currentTime / duration) * 100}%` } as React.CSSProperties}
        />
        <span className={styles.timeTotal}>{formatTime(duration, true)}</span>
        <span className={styles.fpsBadge}>30 FPS</span>
      </div>
    </section>
  )
}
