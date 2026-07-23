'use client'

import { useRef, useState } from 'react'

interface Props {
  src: string
  poster?: string
  onFrameSeek?: (time: number) => void
  currentTime?: number
}

export function VideoPlayer({ src, poster, onFrameSeek, currentTime }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const displayTime = currentTime ?? time

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gv-border">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        controls
        className="w-full"
        onTimeUpdate={() => {
          const t = videoRef.current?.currentTime || 0
          setTime(t)
          onFrameSeek?.(t)
        }}
        onLoadedMetadata={() => {
          setDuration(videoRef.current?.duration || 0)
        }}
      />
      <div className="flex items-center gap-3 px-3 py-2 bg-gv-surface text-xs text-gv-text-dim">
        <span>{formatTime(displayTime)} / {formatTime(duration)}</span>
        <div className="flex gap-1">
          <button
            type="button"
            className="px-2 py-0.5 rounded bg-gv-bg hover:bg-gv-pink/10 transition-colors"
            onClick={() => {
              const v = videoRef.current
              if (v) { v.currentTime = Math.max(0, v.currentTime - 1 / 30); setTime(v.currentTime) }
            }}
          >
            ← Frame
          </button>
          <button
            type="button"
            className="px-2 py-0.5 rounded bg-gv-bg hover:bg-gv-pink/10 transition-colors"
            onClick={() => {
              const v = videoRef.current
              if (v) { v.currentTime = Math.min(v.duration, v.currentTime + 1 / 30); setTime(v.currentTime) }
            }}
          >
            Frame →
          </button>
        </div>
      </div>
    </div>
  )
}
