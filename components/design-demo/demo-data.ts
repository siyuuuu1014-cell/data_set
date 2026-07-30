import type { AnnotationStatus, DemoEntity, DemoVideo, TimelineTrack } from './types'

export const STATUS_LABELS: Record<AnnotationStatus, string> = {
  unannotated: '未标注',
  ai_annotated: 'AI 已标注',
  human_modified: '人工已修改',
  pending_review: '待审核',
  approved: '已通过',
}

export const videos: DemoVideo[] = [
  {
    id: 'video-01',
    name: 'city_walk_014.mp4',
    duration: 148,
    resolution: '1920 × 1080',
    status: 'human_modified',
    progress: 76,
    detail: '3 个片段待确认',
  },
  {
    id: 'video-02',
    name: 'station_platform_06.mp4',
    duration: 96,
    resolution: '1920 × 1080',
    status: 'pending_review',
    progress: 100,
    detail: '等待审核',
  },
  {
    id: 'video-03',
    name: 'campus_bicycle_22.mp4',
    duration: 183,
    resolution: '3840 × 2160',
    status: 'approved',
    progress: 100,
    detail: 'v1.3 已通过',
  },
  {
    id: 'video-04',
    name: 'lobby_camera_a.mp4',
    duration: 72,
    resolution: '1280 × 720',
    status: 'processing',
    progress: 42,
    detail: '正在提取关键帧',
  },
  {
    id: 'video-05',
    name: 'night_crossing_08.mp4',
    duration: 61,
    resolution: '1920 × 1080',
    status: 'error',
    progress: 18,
    detail: '帧提取失败，可重试',
  },
]

export const entities: DemoEntity[] = [
  {
    id: 'person-12',
    label: 'P-012',
    displayName: '行人 12',
    type: 'person',
    confidence: 0.94,
    color: 'clay',
    bbox: { x: 55.5, y: 17, width: 18, height: 66 },
    attributes: {
      category: '成年行人',
      pose: '行走',
      action: '向右穿行',
      occlusion: 0.08,
      source: 'AI 预标注',
    },
  },
  {
    id: 'person-07',
    label: 'P-007',
    displayName: '行人 07',
    type: 'person',
    confidence: 0.88,
    color: 'teal',
    bbox: { x: 26, y: 25, width: 13.5, height: 55 },
    attributes: {
      category: '成年行人',
      pose: '站立',
      action: '等待通行',
      occlusion: 0.21,
      source: 'AI 预标注',
    },
  },
  {
    id: 'object-03',
    label: 'O-003',
    displayName: '手提包',
    type: 'object',
    confidence: 0.83,
    color: 'ochre',
    bbox: { x: 68, y: 58, width: 9, height: 18 },
    attributes: {
      category: '随身物品',
      occlusion: 0.14,
      source: '人工创建',
    },
  },
]

export const timelineTracks: TimelineTrack[] = [
  {
    id: 'scene-track',
    label: '视频片段',
    meta: '8 段',
    kind: 'scene',
    segments: [
      { id: 's1', start: 0, end: 18, status: 'approved', label: '入口' },
      { id: 's2', start: 18, end: 38, status: 'approved', label: '街角' },
      { id: 's3', start: 38, end: 62, status: 'human_modified', label: '斑马线' },
      { id: 's4', start: 62, end: 86, status: 'ai_annotated', label: '路口' },
      { id: 's5', start: 86, end: 112, status: 'pending_review', label: '商店' },
      { id: 's6', start: 112, end: 148, status: 'unannotated', label: '离场' },
    ],
  },
  {
    id: 'person-track',
    label: '人物轨道',
    meta: '12 个对象',
    kind: 'person',
    segments: [
      { id: 'p1', start: 7, end: 31, status: 'approved', label: 'P-007' },
      { id: 'p2', start: 35, end: 81, status: 'human_modified', label: 'P-012' },
      { id: 'p3', start: 93, end: 138, status: 'ai_annotated', label: 'P-018' },
    ],
  },
  {
    id: 'entity-track',
    label: '实体轨道',
    meta: '7 个对象',
    kind: 'object',
    segments: [
      { id: 'o1', start: 13, end: 43, status: 'ai_annotated', label: '自行车' },
      { id: 'o2', start: 41, end: 72, status: 'human_modified', label: '手提包' },
      { id: 'o3', start: 109, end: 145, status: 'pending_review', label: '车辆' },
    ],
  },
  {
    id: 'annotation-track',
    label: '标注区间',
    meta: '5 条事件',
    kind: 'annotation',
    segments: [
      { id: 'a1', start: 20, end: 34, status: 'approved', label: '进入画面' },
      { id: 'a2', start: 38, end: 57, status: 'human_modified', label: '穿过马路' },
      { id: 'a3', start: 88, end: 104, status: 'pending_review', label: '短暂停留' },
    ],
  },
]

export const demoDuration = 148
