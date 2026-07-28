import type { SegmentAnnotation, SegmentState, VideoTaskItem } from './types'

/**
 * Store a completed Worker result without discarding a human-reviewed copy.
 *
 * Human annotations intentionally remain authoritative in the review UI. The
 * newly generated model result is still retained separately for diagnostics
 * and future comparison.
 */
export function applyCompletedModelResult(
  segment: SegmentState,
  result: SegmentAnnotation,
): void {
  const completedMode = segment.processingMode || 'standard'
  const persistedResult = result._identity_aliases
    ? { ...result, _identity_aliases: undefined }
    : result
  segment.modelAnnotation = persistedResult
  segment.status = result._pipeline_status === 'partial_completed'
    ? 'partial_completed'
    : 'completed'

  const errors = result._pipeline_errors
  if (errors?.length) {
    segment.error = errors.join('; ')
  } else {
    delete segment.error
  }
  delete segment.progressPhase
  segment.lastCompletedMode = completedMode
  delete segment.processingMode
}

/** Apply Worker identity reconciliation to every saved segment of one video. */
export function applyIdentityAliasesToVideo(
  video: VideoTaskItem,
  aliases: Record<string, string> | undefined,
): void {
  if (!aliases || Object.keys(aliases).length === 0) return

  const resolve = (personId: string): string => {
    let current = personId
    const visited = new Set<string>()
    while (aliases[current] && !visited.has(current)) {
      visited.add(current)
      current = aliases[current]
    }
    return current
  }

  for (const segment of video.segments || []) {
    for (const annotation of [segment.modelAnnotation, segment.humanAnnotation]) {
      if (!annotation) continue
      for (const person of annotation.persons || []) {
        if (person.personId) person.personId = resolve(person.personId)
      }
    }
  }
}
