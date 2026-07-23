/** Export service — generates Custom JSON, YOLO, COCO formats. */

import JSZip from 'jszip'
import type { VideoAnnotation } from './types'

/** Generate user-specified Custom JSON format. */
export function exportCustomJson(annotations: VideoAnnotation[]): string {
  const output: Record<string, unknown>[] = []
  for (const ann of annotations) {
    output.push({
      video: ann.video,
      annotations: ann.annotations.map(seg => ({
        segmentId: seg.segmentId,
        start: seg.start,
        end: seg.end,
        scene: seg.scene,
        camera: seg.camera,
        persons: seg.persons.map(p => ({
          trackId: p.trackId,
          personId: p.personId,
          gender: p.gender,
          ageGroup: p.ageGroup,
          hair: p.hair,
          expression: p.expression,
          pose: p.pose,
          action: p.action,
          facing: p.facing,
          occlusion: p.occlusion,
          clothing: p.clothing,
          bbox: p.bbox,
          depth: p.depth,
          keypoints: p.keypoints,
        })),
        objects: seg.objects.map(o => ({
          trackId: o.trackId,
          name: o.name,
          category: o.category,
          color: o.color,
          brand: o.brand,
          bbox: o.bbox,
          depth: o.depth,
        })),
        events: seg.events,
      })),
    })
  }
  return JSON.stringify(output, null, 2)
}

/** Generate YOLO format — returns a map of filename → label content. */
export function exportYolo(annotations: VideoAnnotation[]): Map<string, string> {
  const files = new Map<string, string>()
  let classIdx = 0
  const classMap = new Map<string, number>()

  for (const ann of annotations) {
    for (const seg of ann.annotations) {
      for (const p of seg.persons) {
        const className = 'person'
        if (!classMap.has(className)) { classMap.set(className, classIdx++) }
        const cid = classMap.get(className)!
        const cx = (p.bbox.x + p.bbox.width / 2) / ann.video.width
        const cy = (p.bbox.y + p.bbox.height / 2) / ann.video.height
        const w = p.bbox.width / ann.video.width
        const h = p.bbox.height / ann.video.height
        const line = `${cid} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`
        const key = `${ann.video.videoId}_seg${seg.segmentId}.txt`
        const existing = files.get(key) || ''
        files.set(key, existing ? existing + '\n' + line : line)
      }
      for (const o of seg.objects) {
        if (!o.bbox) continue  // skip AI-described objects without localization
        const className = o.name || 'object'
        if (!classMap.has(className)) { classMap.set(className, classIdx++) }
        const cid = classMap.get(className)!
        const cx = (o.bbox.x + o.bbox.width / 2) / ann.video.width
        const cy = (o.bbox.y + o.bbox.height / 2) / ann.video.height
        const w = o.bbox.width / ann.video.width
        const h = o.bbox.height / ann.video.height
        const line = `${cid} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`
        const key = `${ann.video.videoId}_seg${seg.segmentId}.txt`
        const existing = files.get(key) || ''
        files.set(key, existing ? existing + '\n' + line : line)
      }
    }
  }

  // Prepend classes.txt
  const classLines = Array.from(classMap.entries())
    .sort(([, a], [, b]) => a - b)
    .map(([name]) => name)
  files.set('classes.txt', classLines.join('\n'))

  return files
}

/** Generate COCO JSON format. */
export function exportCoco(annotations: VideoAnnotation[]): string {
  const images: Record<string, unknown>[] = []
  const cocoAnnotations: Record<string, unknown>[] = []
  const categories: Record<string, unknown>[] = []
  const catMap = new Map<string, number>()
  let annId = 0
  let imgId = 0
  let catId = 0

  for (const ann of annotations) {
    for (const seg of ann.annotations) {
      imgId++
      images.push({
        id: imgId,
        file_name: `${ann.video.videoId}_seg${seg.segmentId}.jpg`,
        width: ann.video.width,
        height: ann.video.height,
      })

      for (const p of seg.persons) {
        const clsName = 'person'
        if (!catMap.has(clsName)) {
          catMap.set(clsName, ++catId)
          categories.push({ id: catId, name: clsName, supercategory: 'person' })
        }
        annId++
        cocoAnnotations.push({
          id: annId,
          image_id: imgId,
          category_id: catMap.get(clsName),
          bbox: [p.bbox.x, p.bbox.y, p.bbox.width, p.bbox.height],
          area: p.bbox.width * p.bbox.height,
          iscrowd: 0,
        })
      }

      for (const o of seg.objects) {
        if (!o.bbox) continue  // skip AI-described objects without localization
        const clsName = o.name || 'object'
        if (!catMap.has(clsName)) {
          catMap.set(clsName, ++catId)
          categories.push({ id: catId, name: clsName, supercategory: o.category || 'object' })
        }
        annId++
        cocoAnnotations.push({
          id: annId,
          image_id: imgId,
          category_id: catMap.get(clsName),
          bbox: [o.bbox.x, o.bbox.y, o.bbox.width, o.bbox.height],
          area: o.bbox.width * o.bbox.height,
          iscrowd: 0,
        })
      }
    }
  }

  return JSON.stringify({ images, annotations: cocoAnnotations, categories }, null, 2)
}

/** Fetch a keyframe image as a Blob for a segment. */
async function fetchKeyframeImage(videoId: string, start: number, end: number): Promise<Blob | null> {
  const t = (start + end) / 2  // midpoint timestamp
  try {
    const res = await fetch(`/api/video-annotation/files/${videoId}?t=${t}`)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

/** Download a string, Map (→ ZIP), or Blob as a file. */
export async function downloadAsFile(
  content: string | Map<string, string> | Blob,
  filename: string,
  mime = 'application/json'
) {
  if (content instanceof Map) {
    // Build ZIP with labels + classes.txt
    const zip = new JSZip()

    content.forEach((text, name) => {
      if (name === 'classes.txt') {
        zip.file(name, text)
      } else {
        zip.file(`labels/${name}`, text)
      }
    })

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    triggerDownload(zipBlob, filename)
  } else if (content instanceof Blob) {
    triggerDownload(content, filename)
  } else {
    const blob = new Blob([content], { type: mime })
    triggerDownload(blob, filename)
  }
}

/** Download YOLO dataset as a ZIP including keyframe images and labels. */
export async function downloadYoloZip(
  annotations: VideoAnnotation[],
  filename: string
) {
  const labelMap = exportYolo(annotations)
  const zip = new JSZip()

  // Add labels
  labelMap.forEach((text, name) => {
    if (name === 'classes.txt') {
      zip.file(name, text)
    } else {
      zip.file(`labels/${name}`, text)
    }
  })

  // Fetch and add keyframe images
  let imgIdx = 0
  for (const ann of annotations) {
    for (const seg of ann.annotations) {
      imgIdx++
      const imgName = `images/${ann.video.videoId}_seg${seg.segmentId}.jpg`
      const imgBlob = await fetchKeyframeImage(ann.video.videoId, seg.start, seg.end)
      if (imgBlob) {
        zip.file(imgName, imgBlob)
      }
    }
  }

  if (imgIdx === 0 && labelMap.size <= 1) {
    // No labels, no images — nothing useful to export
    return
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  triggerDownload(zipBlob, filename)
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
