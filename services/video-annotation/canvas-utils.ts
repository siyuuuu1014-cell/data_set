/** Canvas BBox drawing utilities — shared between AnnotationCanvas and export thumbnails. */

import { BOX_COLORS } from './constants'
import type { BBox } from './types'

/** Draw a single bounding box with label. */
export function drawRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  label: string,
  lineWidth = 2,
) {
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.strokeRect(x, y, w, h)

  if (label) {
    ctx.font = '12px system-ui, sans-serif'
    const tw = ctx.measureText(label).width + 8
    const labelY = y < 18 ? y + 2 : y - 18
    const textY = y < 18 ? y + 14 : y - 6
    ctx.fillStyle = color
    ctx.fillRect(x, labelY, tw, 18)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x + 4, textY)
  }
}

/** Compute IoU between two [x, y, w, h] boxes. */
export function computeIou(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const ax1 = a.x, ay1 = a.y, ax2 = a.x + a.width, ay2 = a.y + a.height
  const bx1 = b.x, by1 = b.y, bx2 = b.x + b.width, by2 = b.y + b.height
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1)
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2)
  if (ix2 <= ix1 || iy2 <= iy1) return 0
  const inter = (ix2 - ix1) * (iy2 - iy1)
  const areaA = a.width * a.height, areaB = b.width * b.height
  return inter / (areaA + areaB - inter)
}

/** NMS filter for boxes with same className. */
export function nmsFilter(boxes: BBox[], iouThreshold = 0.5): BBox[] {
  const kept: BBox[] = []
  for (const box of boxes) {
    if (!kept.some(k => computeIou(k, box) >= iouThreshold)) {
      kept.push(box)
    }
  }
  return kept
}

/** Get color for a class name, stable across renders. */
const colorCache = new Map<string, string>()
export function getClassColor(className: string): string {
  if (colorCache.has(className)) return colorCache.get(className)!
  const color = BOX_COLORS[colorCache.size % BOX_COLORS.length]
  colorCache.set(className, color)
  return color
}

/** Confidence-based color override. */
export function confidenceColor(conf: number | null | undefined, baseColor: string): string {
  if (conf == null) return baseColor
  if (conf >= 0.8) return baseColor
  if (conf >= 0.5) return '#F59E0B'
  return '#EF4444'
}

/** Scale a BBox by a factor. */
export function scaleBox(box: BBox, scale: number): BBox {
  return {
    x: Math.round(box.x * scale),
    y: Math.round(box.y * scale),
    width: Math.round(box.width * scale),
    height: Math.round(box.height * scale),
  }
}
