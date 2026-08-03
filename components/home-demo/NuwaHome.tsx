import Link from 'next/link'
import styles from './home-demo.module.css'

function DataGlyph() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <rect x="14" y="16" width="26" height="18" rx="3" />
      <rect x="56" y="16" width="26" height="18" rx="3" />
      <rect x="14" y="62" width="26" height="18" rx="3" />
      <rect x="56" y="62" width="26" height="18" rx="3" />
      <path d="M40 25h16M27 34v28M69 34v28M40 71h16" />
      <circle cx="48" cy="48" r="8" />
    </svg>
  )
}

function VideoGlyph() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <rect x="12" y="17" width="72" height="48" rx="5" />
      <path d="m43 34 16 8-16 8Z" />
      <path d="M12 76h72M29 71v10M66 71v10" />
      <circle cx="29" cy="76" r="3" />
      <circle cx="66" cy="76" r="3" />
    </svg>
  )
}

type DataPacketKind = 'schema' | 'json' | 'video' | 'timeline' | 'entity' | 'review'

const DATA_PACKETS: Array<{ kind: DataPacketKind; label: string }> = [
  { kind: 'schema', label: '表结构' },
  { kind: 'json', label: 'JSON' },
  { kind: 'video', label: '视频帧' },
  { kind: 'timeline', label: '时间轴' },
  { kind: 'entity', label: '实体' },
  { kind: 'review', label: '审核' },
]

function DataPacketGlyph({ kind }: { kind: DataPacketKind }) {
  if (kind === 'json') {
    return <svg viewBox="0 0 32 32"><path d="M12 6c-3 0-4 2-4 5v2c0 2-1 3-3 3 2 0 3 1 3 3v2c0 3 1 5 4 5M20 6c3 0 4 2 4 5v2c0 2 1 3 3 3-2 0-3 1-3 3v2c0 3-1 5-4 5" /></svg>
  }

  if (kind === 'video') {
    return <svg viewBox="0 0 32 32"><rect x="4" y="7" width="24" height="18" rx="3" /><path d="m14 12 7 4-7 4Z" /></svg>
  }

  if (kind === 'timeline') {
    return <svg viewBox="0 0 32 32"><path d="M4 10h24M4 16h24M4 22h24" /><path d="M8 8v4M18 14v4M24 20v4" /></svg>
  }

  if (kind === 'entity') {
    return <svg viewBox="0 0 32 32"><circle cx="7" cy="16" r="3" /><circle cx="16" cy="8" r="3" /><circle cx="25" cy="18" r="3" /><path d="m9 14 5-4m4 0 5 6M10 17l12 1" /></svg>
  }

  if (kind === 'review') {
    return <svg viewBox="0 0 32 32"><rect x="5" y="5" width="22" height="22" rx="5" /><path d="m10 16 4 4 8-9" /></svg>
  }

  return <svg viewBox="0 0 32 32"><rect x="5" y="6" width="9" height="7" rx="1" /><rect x="18" y="6" width="9" height="7" rx="1" /><rect x="5" y="19" width="9" height="7" rx="1" /><rect x="18" y="19" width="9" height="7" rx="1" /><path d="M14 9h4M9 13v6M23 13v6M14 22h4" /></svg>
}

function PacketGroup({ copy }: { copy: string }) {
  return (
    <div className={styles.packetGroup}>
      {DATA_PACKETS.map((packet) => (
        <span className={styles.dataPacket} data-kind={packet.kind} key={`${copy}-${packet.kind}`}>
          <span className={styles.packetGlyph}><DataPacketGlyph kind={packet.kind} /></span>
          <span>{packet.label}</span>
        </span>
      ))}
    </div>
  )
}

function DataStreamField() {
  return (
    <div className={styles.dataStreamField} aria-hidden="true">
      <div className={styles.streamGrid} />

      <div className={`${styles.streamTrack} ${styles.trackFar}`}>
        <div className={styles.streamBelt}>
          <PacketGroup copy="far-a" />
          <PacketGroup copy="far-b" />
        </div>
      </div>

      <div className={`${styles.streamTrack} ${styles.trackMid}`}>
        <div className={styles.streamBelt}>
          <PacketGroup copy="mid-a" />
          <PacketGroup copy="mid-b" />
        </div>
      </div>

      <div className={`${styles.streamTrack} ${styles.trackNear}`}>
        <div className={styles.streamBelt}>
          <PacketGroup copy="near-a" />
          <PacketGroup copy="near-b" />
        </div>
      </div>

      <div className={styles.streamHub}>
        <span>NUWA PIPELINE</span>
        <strong>数据已就绪</strong>
        <i><b /><b /><b /><b /></i>
      </div>
    </div>
  )
}

export function NuwaHome() {
  return (
    <main className={styles.homeRoot}>
      <a className={styles.skipLink} href="#workspace-entry">跳至工作区入口</a>

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Nuwa 首页">
          <span className={styles.brandMark}>N</span>
          <span>
            <strong>NUWA</strong>
            <small>智能数据工作台</small>
          </span>
        </Link>
        <p>本地优先 · AI 辅助</p>
      </header>

      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.heroCopy}>
          <h1 id="home-title">把原始素材，<br /><span>变成可用数据。</span></h1>
          <p>选择一个工作区，开始构造数据或审核视频标注。</p>
        </div>
        <DataStreamField />
      </section>

      <nav className={styles.entryGrid} id="workspace-entry" aria-label="选择工作区">
        <Link className={`${styles.entry} ${styles.dataEntry}`} href="/projects">
          <span className={styles.entryIndex}>数据合成</span>
          <span className={styles.entryBody}>
            <span className={styles.entryGlyph}><DataGlyph /></span>
            <span>
              <strong>构造结构化数据</strong>
              <small>设计表结构，生成并导出数据集</small>
            </span>
          </span>
          <span className={styles.entryAction}>进入数据工作区 <i>↗</i></span>
        </Link>

        <Link className={`${styles.entry} ${styles.videoEntry}`} href="/annotations">
          <span className={styles.entryIndex}>视频标注</span>
          <span className={styles.entryBody}>
            <span className={styles.entryGlyph}><VideoGlyph /></span>
            <span>
              <strong>审核视频时间线</strong>
              <small>上传视频，运行 AI 预标注并人工修正</small>
            </span>
          </span>
          <span className={styles.entryAction}>进入视频标注 <i>↗</i></span>
        </Link>
      </nav>
    </main>
  )
}
