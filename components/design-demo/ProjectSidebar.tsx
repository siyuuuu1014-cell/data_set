import { STATUS_LABELS } from './demo-data'
import { DemoIcon, type DemoIconName } from './DemoIcon'
import type { AnnotationStatus, DemoVideo } from './types'
import styles from './design-demo.module.css'

const navItems: Array<{ label: string; icon: DemoIconName; active?: boolean; count?: number }> = [
  { label: '项目概览', icon: 'layers' },
  { label: '数据集', icon: 'dataset' },
  { label: '视频标注', icon: 'annotations', active: true, count: 18 },
  { label: '审核中心', icon: 'review', count: 3 },
  { label: '版本记录', icon: 'archive' },
]

const statusClass: Record<AnnotationStatus, string> = {
  unannotated: styles.statusUnannotated,
  ai_annotated: styles.statusAi,
  human_modified: styles.statusModified,
  pending_review: styles.statusReview,
  approved: styles.statusApproved,
}

interface ProjectSidebarProps {
  videos: DemoVideo[]
  selectedVideoId: string
  onSelectVideo: (videoId: string) => void
  onRetry: (videoId: string) => void
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function ProjectSidebar({ videos, selectedVideoId, onSelectVideo, onRetry }: ProjectSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.primaryNav} aria-label="项目导航">
        <p className={styles.navLabel}>工作区</p>
        {navItems.map(item => (
          <button key={item.label} className={`${styles.navItem} ${item.active ? styles.navItemActive : ''}`} type="button">
            <DemoIcon name={item.icon} />
            <span>{item.label}</span>
            {item.count ? <span className={styles.navCount}>{item.count}</span> : null}
          </button>
        ))}
      </nav>

      <section className={styles.videoSection}>
        <div className={styles.sectionHeading}>
          <div>
            <p>当前任务</p>
            <strong>视频列表</strong>
          </div>
          <button className={styles.smallIconButton} type="button" aria-label="更多视频操作"><DemoIcon name="more" /></button>
        </div>
        <label className={styles.searchBox}>
          <DemoIcon name="search" />
          <input aria-label="搜索视频" placeholder="搜索视频" />
          <kbd>⌘K</kbd>
        </label>

        <div className={styles.videoList}>
          {videos.map((video, index) => {
            const selected = video.id === selectedVideoId
            return (
              <div key={video.id} className={`${styles.videoItem} ${selected ? styles.videoItemActive : ''}`}>
                <button className={styles.videoSelectButton} type="button" onClick={() => onSelectVideo(video.id)}>
                  <span className={`${styles.videoThumb} ${styles[`thumb${(index % 3) + 1}`]}`}>
                    <span>{index + 1}</span>
                  </span>
                  <span className={styles.videoInfo}>
                    <strong>{video.name}</strong>
                    <span>{formatDuration(video.duration)} · {video.resolution}</span>
                    {video.status === 'processing' ? (
                      <span className={styles.processingLine}>
                        <span><i style={{ width: `${video.progress}%` }} /></span>
                        {video.progress}%
                      </span>
                    ) : video.status === 'error' ? (
                      <span className={styles.errorLine}>
                        <DemoIcon name="warning" /> {video.detail}
                      </span>
                    ) : (
                      <span className={`${styles.statusBadge} ${statusClass[video.status]}`}>
                        <i /> {STATUS_LABELS[video.status]}
                      </span>
                    )}
                  </span>
                  <DemoIcon name="chevron" className={styles.rowChevron} />
                </button>
                {video.status === 'error' ? (
                  <button className={styles.retryButton} type="button" onClick={() => onRetry(video.id)}>重试</button>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <section className={styles.reviewSummary}>
        <div className={styles.progressHeader}>
          <span>审核进度</span>
          <strong>68%</strong>
        </div>
        <div className={styles.progressBar}><i /></div>
        <div className={styles.progressStats}>
          <span><i className={styles.dotApproved} />12 已通过</span>
          <span><i className={styles.dotReview} />3 待审核</span>
          <span><i className={styles.dotMuted} />3 未完成</span>
        </div>
      </section>
    </aside>
  )
}
