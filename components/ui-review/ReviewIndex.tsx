import Link from 'next/link'
import { REVIEW_PAGES } from './review-data'
import styles from './ui-review.module.css'

const STATUS_LABEL = {
  pending: '待审查',
  confirmed: '已确认',
  adjust: '需调整',
}

export function ReviewIndex() {
  const pendingCount = REVIEW_PAGES.filter(page => page.status === 'pending').length
  const confirmedCount = REVIEW_PAGES.filter(page => page.status === 'confirmed').length

  return (
    <main className={styles.reviewRoot}>
      <header className={styles.reviewHeader}>
        <Link href="/" className={styles.reviewBrand}>
          <span className={styles.brandMark}>N</span>
          <span><strong>Nuwa UI Review</strong><small>四批隔离预览</small></span>
        </Link>
        <div className={styles.headerMeta}>
          <span>Pink Mist + Lime</span>
          <span>{REVIEW_PAGES.length} 个页面模板</span>
          <span>2026-08-01</span>
        </div>
      </header>

      <section className={styles.reviewIntro}>
        <div>
          <p className={styles.reviewContext}>正式业务不受影响</p>
          <h1>先审查系统，再迁移页面。</h1>
        </div>
        <p>
          本批次验证新主题、页面结构、状态覆盖和响应式策略。所有内容使用 Nuwa
          的真实业务语义，操作不会写入正式数据。
        </p>
      </section>

      <section className={styles.reviewSummary} aria-label="页面审查摘要">
        <dl>
          <div><dt>已确认</dt><dd>{confirmedCount}</dd></div>
          <div><dt>待审查</dt><dd>{pendingCount}</dd></div>
          <div><dt>状态模型</dt><dd>8</dd></div>
        </dl>
        <div className={styles.summaryNote}>
          <strong>隔离预览已收口</strong>
          <span>视频导入、标注导出、身份管理和字段统计完成最终验收；18 个入口均已确认。</span>
        </div>
      </section>

      <section className={styles.reviewTableSection}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>页面审查队列</h2>
            <p>按核心闭环排序。进入页面后可切换业务状态和预览宽度。</p>
          </div>
          <span className={styles.queueCount}>{REVIEW_PAGES.length} / 18</span>
        </div>

        <div className={styles.reviewTable}>
          <div className={styles.reviewTableHeader} aria-hidden="true">
            <span>业务与页面</span>
            <span>优化方式</span>
            <span>主要问题与变化</span>
            <span>状态</span>
          </div>
          {REVIEW_PAGES.map(page => (
            <Link className={styles.reviewRow} href={`/ui-review/pages/${page.key}`} key={page.key}>
              <span className={styles.pageIdentity}>
                <small>{page.module}</small>
                <strong>{page.name}</strong>
                <code>{page.formalRoute}</code>
              </span>
              <span>
                <b className={styles.modeBadge}>{page.mode}</b>
                <small className={styles.pageType}>{page.type}</small>
              </span>
              <span className={styles.rowNarrative}>
                <strong>{page.problem}</strong>
                <small>{page.improvement}</small>
              </span>
              <span className={styles.rowStatus} data-status={page.status}>
                {STATUS_LABEL[page.status]}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <footer className={styles.reviewFooter}>
        <span>主导：impeccable</span>
        <span>依据：ui-ux-pro-max</span>
        <span>首页创意：design-taste-frontend</span>
      </footer>
    </main>
  )
}
