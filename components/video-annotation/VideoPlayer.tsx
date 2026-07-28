'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  src: string
  poster?: string
  onFrameSeek?: (time: number) => void
  currentTime?: number
  startTime?: number
  fps?: number
  frameTimes?: number[]
}

export function VideoPlayer({ src, poster, onFrameSeek, currentTime, startTime = 0, fps = 30, frameTimes }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const displayTime = currentTime ?? time

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const seekToSegment = () => {
      const target = Math.max(0, startTime)
      const bounded = Number.isFinite(video.duration) ? Math.min(video.duration, target) : target
      video.currentTime = bounded
      setTime(bounded)
      onFrameSeek?.(bounded)
    }
    if (video.readyState >= 1) seekToSegment()
    else video.addEventListener('loadedmetadata', seekToSegment, { once: true })
    return () => video.removeEventListener('loadedmetadata', seekToSegment)
  }, [src, startTime, onFrameSeek])

  useEffect(() => {
    const video = videoRef.current
    if (!video || currentTime === undefined || !Number.isFinite(currentTime)) return
    // While playing, the canvas may advance to the nearest sampled annotation
    // without forcing playback backwards to that sample on every timeupdate.
    if (!video.paused) return
    if (Math.abs(video.currentTime - currentTime) > 0.001) video.currentTime = currentTime
    setTime(currentTime)
  }, [currentTime])

  const stepFrame = (direction: -1 | 1) => {
    const video = videoRef.current
    if (!video) return
    const current = video.currentTime
    let target: number
    if (frameTimes?.length) {
      const ordered = [...frameTimes].sort((a, b) => a - b)
      if (direction < 0) target = [...ordered].reverse().find(value => value < current - 0.0005) ?? ordered[0]
      else target = ordered.find(value => value > current + 0.0005) ?? ordered[ordered.length - 1]
    } else {
      target = current + direction / Math.max(fps, 1)
    }
    target = Math.max(0, Math.min(video.duration || target, target))
    video.currentTime = target
    setTime(target)
    onFrameSeek?.(target)
  }

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
            onClick={() => stepFrame(-1)}
          >
            ← Frame
          </button>
          <button
            type="button"
            className="px-2 py-0.5 rounded bg-gv-bg hover:bg-gv-pink/10 transition-colors"
            onClick={() => stepFrame(1)}
          >
            Frame →
          </button>
        </div>
      </div>
    </div>
  )
}
