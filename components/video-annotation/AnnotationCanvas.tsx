'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { CANVAS_MAX_W, CANVAS_MAX_H, CANVAS_MIN_BOX_SIZE } from '@/services/video-annotation/constants'
import { drawRect, getClassColor } from '@/services/video-annotation/canvas-utils'
import { personDisplayId } from '@/services/video-annotation/frame-annotations'
import { useLang } from '@/services/i18n'
import type { PersonAnnotation, ObjectAnnotation, BBox, SpatialEntityType } from '@/services/video-annotation/types'

type CanvasMode = 'view' | 'draw'

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface Props {
  imageUrl: string
  persons: PersonAnnotation[]
  objects: ObjectAnnotation[]
  imgWidth: number
  imgHeight: number
  mode: CanvasMode
  drawEnabled?: boolean
  hiddenTrackKeys: Set<string>
  onModeChange: (mode: CanvasMode) => void
  onDrawBox: (box: BBox, imageWidth: number, imageHeight: number) => void
  onSelectTrack: (trackId: number, entityType: SpatialEntityType) => void
  onResizeBox: (trackId: number, entityType: SpatialEntityType, newBox: BBox, imageWidth: number, imageHeight: number) => void
  selectedTrackId: number | null
  selectedEntityType: SpatialEntityType | null
}

const HANDLE_SIZE = 8
const HANDLE_HIT = 10

export function AnnotationCanvas({
  imageUrl, persons, objects, imgWidth, imgHeight,
  mode, drawEnabled = true, hiddenTrackKeys, onModeChange, onDrawBox, onSelectTrack, onResizeBox, selectedTrackId, selectedEntityType,
}: Props) {
  const { t } = useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const [loadedImage, setLoadedImage] = useState<{ url: string; image: HTMLImageElement } | null>(null)

  // All drag state in refs (no re-renders during drag, direct canvas painting)
  const dragRef = useRef<{
    type: 'draw' | 'move' | 'resize'
    trackId?: number
    entityType?: SpatialEntityType
    startX: number
    startY: number
    startBox?: BBox
    handle?: ResizeHandle
  } | null>(null)
  const previewRef = useRef<BBox | null>(null)

  // The decoded JPEG dimensions include FFmpeg's rotation handling. Prefer
  // them over raw container metadata so vertical videos stay aligned.
  const actualW = loadedImage?.image.naturalWidth || imgWidth || 1920
  const actualH = loadedImage?.image.naturalHeight || imgHeight || 1080

  const scaleRef = useRef(1)

  const [cursor, setCursor] = useState('default')

  const getSelectedBox = useCallback(() => {
    if (selectedTrackId == null) return null
    const p = selectedEntityType === 'person' ? persons.find(x => x.trackId === selectedTrackId) : undefined
    if (p) return { bbox: p.bbox, trackId: p.trackId }
    const o = selectedEntityType === 'object' ? objects.find(x => x.trackId === selectedTrackId) : undefined
    if (o && o.bbox) return { bbox: o.bbox, trackId: o.trackId }
    return null
  }, [persons, objects, selectedTrackId, selectedEntityType])

  const hitHandle = useCallback((mx: number, my: number, selBbox: BBox): ResizeHandle | null => {
    const s = scaleRef.current
    const x = selBbox.x * s, y = selBbox.y * s
    const w = selBbox.width * s, h = selBbox.height * s
    const midX = x + w / 2, midY = y + h / 2
    const handles: [number, number, ResizeHandle][] = [
      [x, y, 'nw'], [midX, y, 'n'], [x + w, y, 'ne'],
      [x + w, midY, 'e'], [x + w, y + h, 'se'],
      [midX, y + h, 's'], [x, y + h, 'sw'], [x, midY, 'w'],
    ]
    for (const [hx, hy, h] of handles) {
      if (Math.abs(mx - hx) < HANDLE_HIT && Math.abs(my - hy) < HANDLE_HIT) return h
    }
    return null
  }, [])

  const findTrackAt = useCallback((mx: number, my: number): { trackId: number; entityType: SpatialEntityType } | null => {
    const s = scaleRef.current
    const cx = mx / s, cy = my / s
    // Objects are painted after persons, so hit-test them first (top-most wins).
    for (const o of [...objects].reverse()) {
      if (hiddenTrackKeys.has(`object:${o.trackId}`)) continue
      if (!o.bbox) continue
      if (cx >= o.bbox.x && cx <= o.bbox.x + o.bbox.width && cy >= o.bbox.y && cy <= o.bbox.y + o.bbox.height) return { trackId: o.trackId, entityType: 'object' }
    }
    for (const p of [...persons].reverse()) {
      if (hiddenTrackKeys.has(`person:${p.trackId}`)) continue
      if (cx >= p.bbox.x && cx <= p.bbox.x + p.bbox.width && cy >= p.bbox.y && cy <= p.bbox.y + p.bbox.height) return { trackId: p.trackId, entityType: 'person' }
    }
    return null
  }, [persons, objects, hiddenTrackKeys])

  const getCursorStyle = (h: ResizeHandle | null): string => {
    if (!h) return 'move'
    const map: Record<ResizeHandle, string> = {
      nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
      e: 'e-resize', se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize',
    }
    return map[h]
  }

  // Canvas redraw — uses cached image (no network during drag)
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (actualW === 0 || actualH === 0) return

    // Scale to fill available container width, capped at CANVAS_MAX_W
    const containerW = canvas.parentElement?.clientWidth || CANVAS_MAX_W
    const maxW = Math.min(CANVAS_MAX_W, containerW - 16) // 16px padding
    const dynamicScale = actualW > 0 && actualH > 0
      ? Math.min(maxW / actualW, CANVAS_MAX_H / actualH, 1) : 1

    const displayW = Math.round(actualW * dynamicScale)
    const displayH = Math.round(actualH * dynamicScale)
    if (canvas.width !== displayW) canvas.width = displayW
    if (canvas.height !== displayH) canvas.height = displayH
    canvas.style.width = displayW + 'px'
    canvas.style.height = displayH + 'px'

    // Store dynamic scale — used by all mouse/touch coordinate mapping
    scaleRef.current = dynamicScale

    ctx.clearRect(0, 0, displayW, displayH)
    const img = loadedImage?.url === imageUrl ? loadedImage.image : null
    if (!img) return
    ctx.drawImage(img, 0, 0, displayW, displayH)

    const isDragging = dragRef.current !== null
    const dragTrackId = dragRef.current?.trackId
    const dragType = dragRef.current?.type

    persons.forEach(p => {
      if (hiddenTrackKeys.has(`person:${p.trackId}`)) return
      if (isDragging && p.trackId === dragTrackId && dragRef.current?.entityType === 'person' && dragType !== 'draw') return
      const isSel = p.trackId === selectedTrackId && selectedEntityType === 'person'
      ctx.globalAlpha = isDragging ? 0.4 : isSel ? 1 : 0.7
      drawRect(ctx, p.bbox.x * dynamicScale, p.bbox.y * dynamicScale, p.bbox.width * dynamicScale, p.bbox.height * dynamicScale,
        isSel ? '#FF6CCE' : getClassColor('person'),
        `${personDisplayId(p.personId, p.trackId)}:${(p as unknown as Record<string, unknown>)._className || p.gender || 'person'}`,
        isSel ? 3 : 2)
      ctx.globalAlpha = 1
    })
    objects.forEach(o => {
      if (hiddenTrackKeys.has(`object:${o.trackId}`)) return
      if (!o.bbox) return
      if (isDragging && o.trackId === dragTrackId && dragRef.current?.entityType === 'object' && dragType !== 'draw') return
      const isSel = o.trackId === selectedTrackId && selectedEntityType === 'object'
      ctx.globalAlpha = isDragging ? 0.4 : isSel ? 1 : 0.7
      drawRect(ctx, o.bbox.x * dynamicScale, o.bbox.y * dynamicScale, o.bbox.width * dynamicScale, o.bbox.height * dynamicScale,
        isSel ? '#CCED68' : getClassColor(o.category),
        `o${o.trackId}:${o.name}`, isSel ? 3 : 2)
      ctx.globalAlpha = 1
    })

    // Draw drag preview
    const pv = previewRef.current
    if (pv) {
      drawRect(ctx, pv.x * dynamicScale, pv.y * dynamicScale, pv.width * dynamicScale, pv.height * dynamicScale,
        dragType === 'draw' ? '#F5B840' : '#CB61ED', '', 3)
    }

    // Resize handles (only when not dragging)
    if (!isDragging && mode === 'view') {
      const sel = getSelectedBox()
      if (sel) {
        const x = sel.bbox.x * dynamicScale, y = sel.bbox.y * dynamicScale
        const w = sel.bbox.width * dynamicScale, h = sel.bbox.height * dynamicScale
        const midX = x + w / 2, midY = y + h / 2
        const handles: [number, number][] = [
          [x, y], [midX, y], [x + w, y], [x + w, midY],
          [x + w, y + h], [midX, y + h], [x, y + h], [x, midY],
        ]
        ctx.fillStyle = '#FF6CCE'
        for (const [hx, hy] of handles) {
          ctx.fillRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1
          ctx.strokeRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
        }
      }
    }
  }, [imageUrl, loadedImage, persons, objects, hiddenTrackKeys, selectedTrackId, selectedEntityType, actualW, actualH, mode, getSelectedBox])

  // Load images outside render. The stale-load guard prevents a slow previous
  // frame from replacing the image after the selected segment changes.
  useEffect(() => {
    let active = true
    const image = new Image()
    image.onload = () => {
      if (active) setLoadedImage({ url: imageUrl, image })
    }
    image.src = imageUrl
    return () => { active = false }
  }, [imageUrl])

  useEffect(() => { redraw() }, [redraw])

  // Re-render on container resize (window resize, panel width change)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas?.parentElement) return
    const el = canvas.parentElement
    const ro = new ResizeObserver(() => redraw())
    ro.observe(el)
    return () => ro.disconnect()
  }, [redraw])

  // Window-level move/up for reliable drag completion
  const windowMoveRef = useRef<(e: MouseEvent) => void>(() => {})
  const windowUpRef = useRef<(e: MouseEvent) => void>(() => {})

  const getCanvasPos = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  // Paint directly to canvas during drag (no React re-render, smooth 60fps)
  const paintFrame = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    // Cheap: just draw the image + drag preview overlay
    // Full redraw is done once by React after drag ends
    redraw()
    ctx.restore()
  }, [redraw])

  const handleWindowMove = useCallback((e: MouseEvent) => {
    const dr = dragRef.current
    if (!dr) return
    const { x, y } = getCanvasPos(e.clientX, e.clientY)
    const s = scaleRef.current

    if (dr.type === 'draw') {
      const boundedX = Math.max(0, Math.min(x, actualW * s))
      const boundedY = Math.max(0, Math.min(y, actualH * s))
      const x1 = Math.min(dr.startX, boundedX), y1 = Math.min(dr.startY, boundedY)
      previewRef.current = { x: x1 / s, y: y1 / s, width: Math.abs(boundedX - dr.startX) / s, height: Math.abs(boundedY - dr.startY) / s }
    } else if (dr.type === 'move') {
      const dx = (x - dr.startX) / s, dy = (y - dr.startY) / s
      previewRef.current = {
        x: Math.round(Math.max(0, Math.min(actualW - dr.startBox!.width, dr.startBox!.x + dx))),
        y: Math.round(Math.max(0, Math.min(actualH - dr.startBox!.height, dr.startBox!.y + dy))),
        width: dr.startBox!.width, height: dr.startBox!.height,
      }
    } else if (dr.type === 'resize') {
      const dx = (x - dr.startX) / s, dy = (y - dr.startY) / s
      const sb = dr.startBox!
      const nb: BBox = { ...sb }
      const h = dr.handle!
      // e/s handles grow from the fixed edge; w/n handles must clamp their
      // moving edge to the opposite edge so width/height can never go
      // negative (dragging past the far side would otherwise collapse the
      // box into a 1px sliver on commit).
      if (h.includes('e')) nb.width = Math.max(CANVAS_MIN_BOX_SIZE, sb.width + dx)
      if (h.includes('w')) {
        nb.x = Math.min(sb.x + sb.width - CANVAS_MIN_BOX_SIZE, Math.max(0, sb.x + dx))
        nb.width = sb.x + sb.width - nb.x
      }
      if (h.includes('s')) nb.height = Math.max(CANVAS_MIN_BOX_SIZE, sb.height + dy)
      if (h.includes('n')) {
        nb.y = Math.min(sb.y + sb.height - CANVAS_MIN_BOX_SIZE, Math.max(0, sb.y + dy))
        nb.height = sb.y + sb.height - nb.y
      }
      if (nb.x < 0) { nb.width += nb.x; nb.x = 0 }
      if (nb.y < 0) { nb.height += nb.y; nb.y = 0 }
      if (nb.x + nb.width > actualW) nb.width = actualW - nb.x
      if (nb.y + nb.height > actualH) nb.height = actualH - nb.y
      nb.x = Math.round(nb.x); nb.y = Math.round(nb.y)
      nb.width = Math.round(nb.width); nb.height = Math.round(nb.height)
      previewRef.current = nb
    }

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(paintFrame)
  }, [actualW, actualH, paintFrame])

  const handleWindowUp = useCallback(() => {
    const dr = dragRef.current
    if (!dr) return
    // Detach listeners
    window.removeEventListener('mousemove', windowMoveRef.current as EventListener)
    window.removeEventListener('mouseup', windowUpRef.current as EventListener)

    const pv = previewRef.current
    if (dr.type === 'draw' && pv && pv.width > CANVAS_MIN_BOX_SIZE && pv.height > CANVAS_MIN_BOX_SIZE) {
      onDrawBox({ x: Math.round(pv.x), y: Math.round(pv.y), width: Math.round(pv.width), height: Math.round(pv.height) }, actualW, actualH)
    } else if ((dr.type === 'move' || dr.type === 'resize') && pv) {
      onResizeBox(dr.trackId!, dr.entityType!, { x: pv.x, y: pv.y, width: pv.width, height: pv.height }, actualW, actualH)
    }

    dragRef.current = null
    previewRef.current = null
    setCursor('default')
    // Trigger one final React re-render
    cancelAnimationFrame(rafRef.current)
    setTimeout(redraw, 0)
  }, [onDrawBox, onResizeBox, redraw, actualW, actualH])

  useEffect(() => {
    windowMoveRef.current = handleWindowMove
    windowUpRef.current = handleWindowUp
  }, [handleWindowMove, handleWindowUp])

  useEffect(() => () => {
    window.removeEventListener('mousemove', windowMoveRef.current as EventListener)
    window.removeEventListener('mouseup', windowUpRef.current as EventListener)
    cancelAnimationFrame(rafRef.current)
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const { x, y } = getCanvasPos(e.clientX, e.clientY)
    const s = scaleRef.current

    if (mode === 'draw') {
      if (!drawEnabled) return
      dragRef.current = { type: 'draw', startX: x, startY: y }
      previewRef.current = { x: x / s, y: y / s, width: 0, height: 0 }
      setCursor('crosshair')
      window.addEventListener('mousemove', windowMoveRef.current as EventListener)
      window.addEventListener('mouseup', windowUpRef.current as EventListener)
      return
    }

    const sel = getSelectedBox()
    if (sel) {
      const handle = hitHandle(x, y, sel.bbox)
      if (handle) {
        dragRef.current = { type: 'resize', trackId: sel.trackId, entityType: selectedEntityType!, startX: x, startY: y, startBox: { ...sel.bbox }, handle }
        previewRef.current = { ...sel.bbox }
        setCursor(getCursorStyle(handle))
        window.addEventListener('mousemove', windowMoveRef.current as EventListener)
        window.addEventListener('mouseup', windowUpRef.current as EventListener)
        return
      }
      const cx = x / s, cy = y / s
      if (cx >= sel.bbox.x && cx <= sel.bbox.x + sel.bbox.width && cy >= sel.bbox.y && cy <= sel.bbox.y + sel.bbox.height) {
        dragRef.current = { type: 'move', trackId: sel.trackId, entityType: selectedEntityType!, startX: x, startY: y, startBox: { ...sel.bbox } }
        previewRef.current = { ...sel.bbox }
        setCursor('move')
        window.addEventListener('mousemove', windowMoveRef.current as EventListener)
        window.addEventListener('mouseup', windowUpRef.current as EventListener)
        return
      }
    }

    const hit = findTrackAt(x, y)
    if (hit !== null) onSelectTrack(hit.trackId, hit.entityType)
  }, [mode, drawEnabled, getSelectedBox, hitHandle, findTrackAt, onSelectTrack, selectedEntityType])

  // Keyboard delete handled by parent page (avoid double confirm)


  return (
    <div className="rounded-lg overflow-hidden bg-gv-bg-deep border border-gv-border">
      <div className="flex items-center gap-3 px-3 py-2 bg-gv-surface border-b border-gv-border-light">
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input type="radio" name="canvas-mode" checked={mode === 'view'}
            onChange={() => onModeChange('view')} className="h-3 w-3 accent-gv-pink" />
          <span className="text-gv-text-dim">{t('annotation.canvas_view')}</span>
        </label>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input type="radio" name="canvas-mode" checked={mode === 'draw'}
            onChange={() => onModeChange('draw')} className="h-3 w-3 accent-gv-pink" />
          <span className="text-gv-text-dim">{t('annotation.canvas_draw')}</span>
        </label>
        {mode === 'draw'
          ? <span className="text-xs text-gv-pink">{drawEnabled ? t('annotation.drag_to_draw') : t('annotation.choose_type_first')}</span>
          : <span className="text-xs text-gv-text-muted">{selectedTrackId != null ? t('annotation.drag_to_resize') : t('annotation.click_to_select')}</span>}
        <span className="flex-1" />
        <span className="text-xs text-gv-text-muted">{t('annotation.track_count', persons.length + objects.length)}</span>
      </div>
      <canvas ref={canvasRef} onMouseDown={onMouseDown} style={{ cursor }} className="block mx-auto" aria-label={t('annotation.canvas_label')} />
    </div>
  )
}
