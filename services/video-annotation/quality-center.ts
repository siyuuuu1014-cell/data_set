import type { AnnotateSet, SegmentAnnotation, SegmentState } from './types'

export type QualityIssueSeverity = 'critical' | 'warning' | 'info'
export type QualityIssueKind = 'failed' | 'degraded' | 'unreviewed' | 'unknown_fields' | 'empty_entities' | 'identity' | 'recognition'

export interface QualityIssue {
  id: string
  severity: QualityIssueSeverity
  kind: QualityIssueKind
  videoId: string
  videoName: string
  segmentId: number
  title: string
  detail: string
}

function effectiveAnnotation(segment: SegmentState): SegmentAnnotation | null {
  return segment.humanAnnotation || segment.modelAnnotation
}

function unknownPersonRatio(annotation: SegmentAnnotation): number {
  const values = (annotation.persons || []).flatMap(person => [
    person.gender, person.ageGroup, person.hair?.color, person.hair?.style,
    person.expression, person.pose, person.facing,
  ])
  if (values.length === 0) return 0
  return values.filter(value => !value || value === 'unknown').length / values.length
}

export function deriveQualityIssues(task: AnnotateSet): QualityIssue[] {
  const issues: QualityIssue[] = []
  for (const video of task.videos || []) {
    const identityOccurrences = new Map<string, Set<number>>()
    for (const segment of video.segments || []) {
      const annotation = effectiveAnnotation(segment)
      const push = (kind: QualityIssueKind, severity: QualityIssueSeverity, title: string, detail: string, discriminator = '') => {
        // Discriminate issues that can repeat within one segment (e.g. one
        // identity issue per track) so keys stay unique for the UI.
        issues.push({ id: `${video.videoId}:${segment.segmentId}:${kind}${discriminator}`, kind, severity, videoId: video.videoId, videoName: video.fileName, segmentId: segment.segmentId, title, detail })
      }
      if (segment.status === 'failed') push('failed', 'critical', 'Annotation failed', segment.error || 'The Worker did not produce a usable result.')
      if (segment.status === 'partial_completed') push('degraded', 'critical', 'Degraded result', segment.error || annotation?._pipeline_errors?.[0] || 'At least one enabled provider failed.')
      if (annotation && segment.reviewStatus !== 'approved') push('unreviewed', 'info', 'Needs human review', `Review status: ${segment.reviewStatus || 'unreviewed'}.`)
      if (!annotation) continue
      const persons = annotation.persons || []
      const objects = annotation.objects || []
      const unknownRatio = unknownPersonRatio(annotation)
      if (persons.length > 0 && unknownRatio >= 0.5) push('unknown_fields', 'warning', 'Many person fields are unknown', `${Math.round(unknownRatio * 100)}% of core person attributes are unknown.`)
      const visualEvents = (annotation.events || []).filter(event => !event.type.startsWith('[Speech]'))
      if (persons.length === 0 && objects.filter(object => !object._textContent && object.category !== 'text').length === 0 && visualEvents.length > 0) {
        push('empty_entities', 'warning', 'Description has no localized entities', 'The segment has a visual event but no localized person or object.')
      }
      if (annotation._recognition?.ocr?.status === 'failed' || annotation._recognition?.speech?.status === 'failed') push('recognition', 'warning', 'Text recognition needs attention', 'OCR or speech recognition failed.')
      for (const person of persons) {
        if (!person.personId) push('identity', 'warning', 'Person has no video identity', `Track ${person.trackId} has no personId.`, `:${person.trackId}`)
        else {
          const seen = identityOccurrences.get(person.personId) || new Set<number>()
          seen.add(segment.segmentId)
          identityOccurrences.set(person.personId, seen)
        }
      }
    }
  }
  const rank = { critical: 0, warning: 1, info: 2 }
  return issues.sort((left, right) => rank[left.severity] - rank[right.severity] || left.videoName.localeCompare(right.videoName) || left.segmentId - right.segmentId)
}

export function qualitySummary(issues: QualityIssue[]) {
  return {
    critical: issues.filter(issue => issue.severity === 'critical').length,
    warning: issues.filter(issue => issue.severity === 'warning').length,
    unreviewed: issues.filter(issue => issue.kind === 'unreviewed').length,
    total: issues.length,
  }
}
