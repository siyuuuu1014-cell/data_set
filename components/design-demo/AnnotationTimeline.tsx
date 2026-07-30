import { STATUS_LABELS } from './demo-data'
import { DemoIcon } from './DemoIcon'
import { formatTime } from './VideoAnnotationStage'
import type { AnnotationStatus, TimelineTrack } from './types'
import styles from './design-demo.module.css'

const ticks = [0, 18.5, 37, 55.5, 74, 92.5, 111, 129.5, 148]

const statusClass: Record<AnnotationStatus, string> = {
  unannotated: styles.segmentUnannotated,
  ai_annotated: styles.segmentAi,
  human_modified: styles.segmentModified,
  pending_review: styles.segmentReview,
  approved: styles.segmentApproved,
}

interface AnnotationTimelineProps {
  tracks: TimelineTrack[]
  duration: number
  currentTime: number
  selectedSegmentId: string | null
  onSeek: (time: number) => void
  onSelectSegment: (id: string, midpoint: number) => void
}

export function AnnotationTimeline({ tracks, duration, currentTime, selectedSegmentId, onSeek, onSelectSegment }: AnnotationTimelineProps) {
  return (
    <section className={styles.timelinePanel}>
      <div className={styles.timelineHeader}>
        <div>
          <span className={styles.panelKicker}>时间线</span>
          <strong>多轨标注</strong>
        </div>
        <div className={styles.timelineLegend} aria-label="标注状态图例">
          {(['unannotated', 'ai_annotated', 'human_modified', 'pending_review', 'approved'] as AnnotationStatus[]).map(status => (
            <span key={status}><i className={statusClass[status]} />{STATUS_LABELS[status]}</span>
          ))}
        </div>
        <div className={styles.timelineTools}>
          <button className={styles.textButton} type="button">吸附 开</button>
          <button className={styles.toolButton} type="button" aria-label="时间轴设置"><DemoIcon name="settings" /></button>
        </div>
      </div>

      <div className={styles.timelineGrid}>
        <div className={styles.trackHeaderCell}>轨道</div>
        <div className={styles.ruler} onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          onSeek(((event.clientX - rect.left) / rect.width) * duration)
        }}>
          {ticks.map(tick => (
            <span key={tick} style={{ left: `${(tick / duration) * 100}%` }}>
              <i />{formatTime(tick)}
            </span>
          ))}
        </div>

        {tracks.map(track => (
          <div className={styles.trackRow} key={track.id}>
            <div className={styles.trackLabel}>
              <span className={`${styles.trackKind} ${styles[`track${track.kind}`]}`} />
              <div><strong>{track.label}</strong><span>{track.meta}</span></div>
            </div>
            <div className={styles.trackLane} onClick={event => {
              if (event.target !== event.currentTarget) return
              const rect = event.currentTarget.getBoundingClientRect()
              onSeek(((event.clientX - rect.left) / rect.width) * duration)
            }}>
              {ticks.slice(1).map(tick => <i key={tick} className={styles.gridLine} style={{ left: `${(tick / duration) * 100}%` }} />)}
              {track.segments.map(segment => (
                <button
                  key={segment.id}
                  type="button"
                  className={`${styles.timelineSegment} ${statusClass[segment.status]} ${selectedSegmentId === segment.id ? styles.timelineSegmentSelected : ''}`}
                  style={{
                    left: `${(segment.start / duration) * 100}%`,
                    width: `${((segment.end - segment.start) / duration) * 100}%`,
                  }}
                  title={`${segment.label || track.label} · ${STATUS_LABELS[segment.status]}`}
                  onClick={() => onSelectSegment(segment.id, (segment.start + segment.end) / 2)}
                >
                  <span>{segment.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className={styles.playhead} style={{ left: `calc(var(--timeline-label-width, 152px) + (100% - var(--timeline-label-width, 152px)) * ${currentTime / duration})` }} aria-hidden="true">
          <span>{formatTime(currentTime, true)}</span>
          <i />
        </div>
      </div>
    </section>
  )
}
