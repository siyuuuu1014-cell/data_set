import styles from './ui-review.module.css'

export function PreviewChrome({
  area,
  children,
  compact = false,
}: {
  area: '数据合成' | '视频标注' | '工作区入口' | '系统设置'
  children: React.ReactNode
  compact?: boolean
}) {
  return (
    <div className={styles.productShell} data-compact={compact || undefined}>
      <header className={styles.productHeader}>
        <div className={styles.productBrand}>
          <span className={styles.productMark}>N</span>
          <strong>NUWA</strong>
        </div>
        <nav aria-label="工作区导航">
          <button type="button" aria-current={area === '数据合成' ? 'page' : undefined}>数据合成</button>
          <button type="button" aria-current={area === '视频标注' ? 'page' : undefined}>视频标注</button>
        </nav>
        <div className={styles.productUtilities}>
          <span className={styles.serviceStatus}><i />服务就绪</span>
          <button type="button" aria-current={area === '系统设置' ? 'page' : undefined}>设置</button>
        </div>
      </header>
      {children}
    </div>
  )
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className={styles.skeletonRows} role="status" aria-label="正在加载">
      {Array.from({ length: count }, (_, index) => (
        <div key={index}><i /><span /><b /></div>
      ))}
    </div>
  )
}

export function StatePanel({
  kind,
  title,
  description,
  action,
}: {
  kind: 'empty' | 'error'
  title: string
  description: string
  action: string
}) {
  return (
    <section className={styles.statePanel} data-kind={kind}>
      <span className={styles.stateMark}>{kind === 'error' ? '!' : '0'}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <button type="button">{action}</button>
    </section>
  )
}
