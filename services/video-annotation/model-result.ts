import type { SegmentAnnotation, SegmentState } from './types'

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
  segment.modelAnnotation = result
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
