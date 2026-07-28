import type {
  AnnotationExecutionMode,
  DeploymentStatus,
} from './types'

interface AnnotationOptionsInput {
  videoId: string
  segmentId: number
  mode: AnnotationExecutionMode
}

/**
 * Build per-job Worker options.
 *
 * LocateAnything stays installed and globally available, but ordinary
 * annotation jobs opt out explicitly. A precision job opts in for only the
 * selected segment.
 */
export function buildAnnotationOptions({
  videoId,
  segmentId,
  mode,
}: AnnotationOptionsInput): Record<string, unknown> {
  return {
    sample_fps: 0.5,
    tracking_fps: 3,
    ontology: {},
    video_id: videoId,
    segment_id: segmentId,
    providers: {
      locate_anything: mode === 'precision',
    },
  }
}

export function precisionAvailabilityError(
  deployment: DeploymentStatus,
): string | null {
  if (deployment.mode !== 'enhanced') {
    return 'Precise Locate requires enhanced deployment mode. Enable and prepare enhanced mode in Settings first.'
  }
  if (deployment.enhancedSetup.status !== 'ready') {
    return deployment.enhancedSetup.error
      || deployment.enhancedSetup.providerReason
      || 'LocateAnything is not ready. Complete enhanced model preparation in Settings first.'
  }
  return null
}
