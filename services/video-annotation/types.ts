// ── BBox & Spatial ──────────────────────────────────────────

export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

export type SpatialEntityType = 'person' | 'object'
export type FrameObservationSource = 'model' | 'manual' | 'interpolated'

/** A spatial observation belongs to one decoded video frame, not a segment. */
export interface FrameObservation {
  trackId: number
  entityType: SpatialEntityType
  className: string
  bbox: BBox
  confidence?: number
  source: FrameObservationSource
}

/**
 * Timestamp is the playback source of truth. frameIndex is retained for stable
 * addressing/caching and is derived from the video's nominal FPS for CFR video.
 */
export interface FrameAnnotation {
  frameIndex: number
  timestamp: number
  imageWidth: number
  imageHeight: number
  observations: FrameObservation[]
}

// ── Semantic attributes ────────────────────────────────────

export interface HairInfo {
  color: string
  style: string
}

export interface ClothingItem {
  type: string
  color: string
  attributes: string[]
  brand: string | null
}

export interface PlaceInfo {
  type: string
  indoor: boolean
  weather: string | null
  lighting: string
  timeOfDay: string
}

// ── Annotations ────────────────────────────────────────────

export interface PersonAnnotation {
  trackId: number
  personId: string | null

  gender: string
  ageGroup: string
  hair: HairInfo
  expression: string
  pose: string
  action: string[]
  facing: string
  occlusion: number

  clothing: ClothingItem[]

  bbox: BBox
  depth: number | null

  keypoints: unknown[]  // reserved, always [] in Phase 1
  _className?: string
  _detectionConfidence?: number
}

export interface ObjectAnnotation {
  trackId: number
  name: string
  category: string
  color: string
  brand: string | null

  bbox: BBox | null  // null when described by Qwen without localization
  depth: number | null
  _textContent?: string
  _detectionConfidence?: number
  /** Preserves a video identity when a person track is manually converted to an object. */
  _convertedPersonId?: string
}

export interface EventAnnotation {
  type: string
  description?: string
  confidence: number
  _confidenceAvailable?: boolean
}

export type RecognitionStageStatus =
  | 'pending'
  | 'completed'
  | 'no_content'
  | 'no_audio'
  | 'disabled'
  | 'skipped'
  | 'failed'

export interface RecognitionStageResult {
  status: RecognitionStageStatus
  count: number
  reason?: string
  error?: string
}

export interface SegmentRecognitionStatus {
  ocr?: RecognitionStageResult
  speech?: RecognitionStageResult
}

export type ProviderExecutionStatus = 'pending' | 'completed' | 'disabled' | 'skipped' | 'failed'

export interface ProviderExecutionResult {
  status: ProviderExecutionStatus
  reason?: string
  error?: string
  source?: 'local_qwen' | 'remote_api'
}

export interface SceneAnnotation {
  tags: string[]
  place: PlaceInfo
}

export interface CameraAnnotation {
  shot: string
  angle: string
  movement: string[]
  lens: string
  stabilization: string
}

export interface SegmentAnnotation {
  segmentId: number
  start: number
  end: number

  scene: SceneAnnotation
  camera: CameraAnnotation
  persons: PersonAnnotation[]
  objects: ObjectAnnotation[]
  events: EventAnnotation[]
  /** Optional for backward compatibility with annotations created before frame editing. */
  frames?: FrameAnnotation[]
  speechTranscript?: string
  _recognition?: SegmentRecognitionStatus
  _pipeline_errors?: string[]
  _provider_statuses?: Record<string, ProviderExecutionResult>
  _pipeline_status?: 'completed' | 'partial_completed'
  _identity_aliases?: Record<string, string>
  _humanEdited?: boolean
}

// ── Video & Task ───────────────────────────────────────────

export interface VideoInfo {
  videoId: string
  filePath: string
  duration: number
  fps: number
  width: number
  height: number
  description: string
}

export interface VideoAnnotation {
  video: VideoInfo
  annotations: SegmentAnnotation[]
}

// ── Video task item ────────────────────────────────────────

export type VideoTaskStatus =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'partial_completed'
  | 'failed'

export interface VideoTaskItem {
  videoId: string
  fileName: string
  filePath: string
  duration: number
  fps: number
  width: number
  height: number
  status: VideoTaskStatus
  segments: SegmentState[]
  uploadProgress: number  // 0-100
}

// ── Segment state ──────────────────────────────────────────

export type SegmentStatus =
  | 'draft'
  | 'confirmed'
  | 'processing'
  | 'completed'
  | 'partial_completed'
  | 'failed'
  | 'skipped'

export type AnnotationExecutionMode = 'standard' | 'precision'

export interface SegmentState {
  segmentId: number
  start: number
  end: number
  status: SegmentStatus
  modelAnnotation: SegmentAnnotation | null
  humanAnnotation: SegmentAnnotation | null
  error?: string
  progressPhase?: string
  workerJobId?: string
  processingMode?: AnnotationExecutionMode
  lastCompletedMode?: AnnotationExecutionMode
}

// ── Annotate set ───────────────────────────────────────────

export type AnnotateSetStatus =
  | 'draft'
  | 'uploading'
  | 'splitting'
  | 'awaiting_segment_review'
  | 'annotating'
  | 'validating'
  | 'awaiting_review'
  | 'approved'
  | 'completed'
  | 'partial_completed'
  | 'failed'
  | 'cancelled'

export interface AnnotateSet {
  id: string
  projectId: string
  name: string
  status: AnnotateSetStatus
  videos: VideoTaskItem[]
  createdAt: string
  updatedAt: string
}

// ── Worker ─────────────────────────────────────────────────

export interface WorkerJobStatus {
  jobId: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number  // 0-100
  progressDetail?: string  // e.g. "YOLO11 detection", "Qwen3-VL semantic"
  result: SegmentAnnotation | null
  error: string | null
}

export interface WorkerHealth {
  status: 'ok' | 'unavailable'
  modelsLoaded: string[]
  device?: 'cpu' | 'cuda' | 'mps'
  queue_size?: number
}

export type DeploymentMode = 'standard' | 'enhanced'

export interface EnhancedSetupStatus {
  status: 'idle' | 'auth_required' | 'checking_access' | 'access_required' | 'downloading' | 'ready' | 'failed'
  phase: 'authorization' | 'access' | 'download' | 'compatibility' | 'ready' | null
  error: string | null
  updatedAt: number | null
  model: string | null
  modelUrl: string
  providerStatus: string
  providerReason: string | null
  cacheRoot: string
  localModelPath: string | null
  downloadRequired: boolean
  approximateDownloadGb: number
}

export interface DeploymentStatus {
  mode: DeploymentMode
  managedByEnvironment: boolean
  huggingFace: {
    authenticated: boolean
    source: 'environment' | 'cache' | null
    username: string | null
    error: string | null
  }
  enhancedSetup: EnhancedSetupStatus
}

// ── Export ─────────────────────────────────────────────────

export type ExportFormat = 'json' | 'yolo' | 'coco'

// ── API ────────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details?: unknown
    retryable: boolean
  }
}

// ── Merge / Review ─────────────────────────────────────────

export interface AnnotationChange {
  path: string
  before: unknown
  after: unknown
  changedAt: string
}

export type ReviewStatus =
  | 'unreviewed'
  | 'needs_review'
  | 'modified'
  | 'approved'
  | 'rejected'

export interface AnnotationReview {
  taskId: string
  videoId: string
  modelAnnotation: VideoAnnotation
  humanAnnotation: VideoAnnotation
  changes: AnnotationChange[]
  reviewStatus: ReviewStatus
  reviewerName: string | null
  reviewedAt: string | null
}
