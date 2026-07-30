export type AnnotationStatus =
  | 'unannotated'
  | 'ai_annotated'
  | 'human_modified'
  | 'pending_review'
  | 'approved'

export type DesignScheme = 'A' | 'B'

export type VideoState = AnnotationStatus | 'processing' | 'error'

export type EntityType = 'person' | 'object'

export interface DemoVideo {
  id: string
  name: string
  duration: number
  resolution: string
  status: VideoState
  progress: number
  detail: string
}

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface DemoEntity {
  id: string
  label: string
  displayName: string
  type: EntityType
  confidence: number
  color: string
  bbox: BoundingBox
  attributes: {
    category: string
    pose?: string
    action?: string
    occlusion: number
    source: 'AI 预标注' | '人工创建'
  }
}

export interface TimelineSegment {
  id: string
  start: number
  end: number
  status: AnnotationStatus
  label?: string
}

export interface TimelineTrack {
  id: string
  label: string
  meta: string
  kind: 'scene' | EntityType | 'annotation'
  segments: TimelineSegment[]
}
