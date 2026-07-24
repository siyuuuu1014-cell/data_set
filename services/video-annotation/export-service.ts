/** Export service — generates Custom JSON, YOLO, COCO formats. */

import JSZip from 'jszip'
import type { SegmentAnnotation, VideoAnnotation } from './types'

const MAX_DESCRIPTION_LENGTH = 300

function compactValue(rawValue: string, maxLength = 48): string {
  const value = rawValue.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, '')
  if (value.length <= maxLength) return value
  const shortened = value.slice(0, maxLength - 1).replace(/\s+\S*$/, '').trim()
  return `${shortened || value.slice(0, maxLength - 1)}…`
}

function rankedValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const rawValue of values) {
    const value = compactValue(rawValue)
    if (!value || value === 'unknown') continue
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value)
}

function joinNatural(values: string[]): string {
  if (values.length < 2) return values[0] || ''
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`
}

function limitDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_LENGTH) return description
  const shortened = description
    .slice(0, MAX_DESCRIPTION_LENGTH - 1)
    .replace(/\s+\S*$/, '')
    .replace(/[.,;: ]+$/, '')
  return `${shortened}…`
}

/** Build one deterministic video-level summary from every annotated segment. */
export function generateVideoDescription(segments: SegmentAnnotation[]): string {
  if (segments.length === 0) return ''

  const chronological = [...segments].sort((a, b) => a.start - b.start)
  const places: string[] = []
  const people: string[] = []
  const actions: string[] = []
  const eventDescriptions: string[] = []
  const objects: string[] = []
  let hasSpeech = false
  let hasOnScreenText = false

  for (const segment of chronological) {
    const place = segment.scene?.place?.type
    const sceneLabels = new Set<string>()
    if (place && place !== 'unknown') sceneLabels.add(place.replace(/_/g, ' '))
    for (const tag of segment.scene?.tags || []) sceneLabels.add(tag.replace(/_/g, ' '))
    places.push(...sceneLabels)

    for (const person of segment.persons || []) {
      const identity = [
        person.gender !== 'unknown' ? person.gender : '',
        person.ageGroup !== 'unknown' ? person.ageGroup : '',
      ].filter(Boolean).join(' ')
      if (identity) people.push(identity)
      actions.push(...(person.action || []).filter(Boolean))
    }

    for (const object of segment.objects || []) {
      if (object._textContent) hasOnScreenText = true
      else if (object.name && object.name !== 'unknown') objects.push(object.name)
    }

    for (const event of segment.events || []) {
      if (!event.type) continue
      if (event.type.startsWith('[Speech]')) hasSpeech = true
      else eventDescriptions.push(event.type)
    }
  }

  const start = chronological[0].start
  const end = chronological[chronological.length - 1].end
  const duration = Math.max(0, end - start)
  let summary = `A ${duration.toFixed(1)}-second video`

  const mainScenes = rankedValues(places, 2)
  if (mainScenes.length) summary += ` mainly set in ${joinNatural(mainScenes)}`

  const mainPeople = rankedValues(people, 2)
  if (mainPeople.length) summary += `, featuring ${joinNatural(mainPeople)}`

  const mainActions = rankedValues(actions, 3)
  const mainEvents = rankedValues(eventDescriptions, 2)
  if (mainActions.length) summary += `${mainPeople.length ? ' engaged in' : ', centered on'} ${joinNatural(mainActions)}`
  else if (mainEvents.length) summary += `, with key events involving ${joinNatural(mainEvents)}`

  const mainObjects = rankedValues(objects, 3)
  if (mainObjects.length) summary += `, with ${joinNatural(mainObjects)} recurring on screen`

  if (hasSpeech && hasOnScreenText) summary += ', and containing both speech and on-screen text'
  else if (hasSpeech) summary += ', and containing speech'
  else if (hasOnScreenText) summary += ', and containing on-screen text'

  return limitDescription(`${summary}.`)
}

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
