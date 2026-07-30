import type { DemoEntity } from './types'
import styles from './design-demo.module.css'

interface MockVideoFrameProps {
  entities: DemoEntity[]
  selectedEntityId: string | null
  onSelectEntity: (id: string) => void
}

export function MockVideoFrame({ entities, selectedEntityId, onSelectEntity }: MockVideoFrameProps) {
  return (
    <div className={styles.videoFrame} aria-label="模拟视频标注画布">
      <svg className={styles.sceneArtwork} viewBox="0 0 960 540" role="img" aria-label="城市街道路口视频帧">
        <defs>
          <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#9aa8a5" />
            <stop offset="1" stopColor="#c8cdc7" />
          </linearGradient>
          <linearGradient id="road" x1="0" x2="1">
            <stop offset="0" stopColor="#4b514f" />
            <stop offset="1" stopColor="#383d3c" />
          </linearGradient>
        </defs>
        <rect width="960" height="540" fill="url(#sky)" />
        <rect x="0" y="130" width="230" height="210" fill="#666c68" />
        <rect x="22" y="160" width="50" height="88" fill="#343a39" />
        <rect x="90" y="160" width="50" height="88" fill="#343a39" />
        <rect x="158" y="160" width="50" height="88" fill="#343a39" />
        <rect x="720" y="92" width="240" height="265" fill="#73766e" />
        <rect x="755" y="130" width="64" height="112" fill="#444a47" />
        <rect x="840" y="130" width="64" height="112" fill="#444a47" />
        <path d="M0 312 960 270v270H0Z" fill="url(#road)" />
        <path d="M0 370 960 330" stroke="#747a76" strokeWidth="4" />
        <g opacity=".83" fill="#d8d7cb">
          <path d="m77 421 142-12 47 17-146 13Z" />
          <path d="m300 402 139-12 55 17-147 13Z" />
          <path d="m534 381 136-11 59 17-143 12Z" />
          <path d="m766 360 128-10 62 16-137 12Z" />
        </g>
        <path d="M0 330 960 291" stroke="#d7b16f" strokeWidth="3" strokeDasharray="34 26" opacity=".72" />
        <g fill="#252b29">
          <circle cx="319" cy="200" r="21" />
          <path d="M294 226h49l13 116h-77Z" />
          <path d="m300 257-54 65 15 10 57-47ZM338 257l46 72 17-10-49-74Z" />
          <path d="m297 338-9 107h20l16-90 12 90h21l-12-108Z" />
          <circle cx="624" cy="161" r="24" />
          <path d="M594 190h61l19 140h-99Z" />
          <path d="m606 321-16 126h25l22-102 17 102h25l-10-127Z" />
          <path d="m600 215-64 78 17 15 68-63ZM650 211l70 66-15 17-75-61Z" />
        </g>
        <path d="M655 300h64l13 80h-84Z" fill="#8d633e" />
        <rect width="960" height="540" fill="#19201e" opacity=".08" />
      </svg>

      <div className={styles.frameMeta}>CAM 04 · 30 FPS · FRAME 1296</div>
      <div className={styles.crosshairHorizontal} />
      <div className={styles.crosshairVertical} />

      {entities.map(entity => {
        const selected = entity.id === selectedEntityId
        return (
          <button
            key={entity.id}
            type="button"
            aria-label={`选择${entity.displayName}`}
            className={`${styles.detectionBox} ${styles[`box${entity.color}`]} ${selected ? styles.detectionBoxSelected : ''}`}
            style={{
              left: `${entity.bbox.x}%`,
              top: `${entity.bbox.y}%`,
              width: `${entity.bbox.width}%`,
              height: `${entity.bbox.height}%`,
            }}
            onClick={() => onSelectEntity(entity.id)}
          >
            <span>{entity.label} · {Math.round(entity.confidence * 100)}%</span>
            {selected ? <><i className={styles.handleNW} /><i className={styles.handleNE} /><i className={styles.handleSW} /><i className={styles.handleSE} /></> : null}
          </button>
        )
      })}
    </div>
  )
}
