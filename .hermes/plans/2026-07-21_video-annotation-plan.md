# 视频 BBox 标注模块 实施计划

> **For Hermes:** Use subagent-driven-development skill to implement this plan phase-by-phase.

**Goal:** 在 nuwa（Next.js 合成数据平台）中新增视频 BBox 标注模块，支持自动镜头切分、逐帧检测+跟踪、细粒度语义属性标注、人工审核修正、导出 Custom JSON / YOLO / COCO。

**Architecture:** Next.js App Router 前端 + API Routes + 同仓库 Python Worker（FastAPI，localhost）。Python Worker 按阶段自动切换模型（YOLO11n → ByteTrack → LocateAnything-3B → Qwen3-VL-2B → Depth Anything v2），前端通过轮询获取状态。

**Tech Stack:** Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS 4 + Python FastAPI + PyTorch + Ultralytics + Transformers + PySceneDetect

---

## 关键决策（已确认）

| 项目 | 决定 |
|------|------|
| 标注粒度 | 关键帧（每镜头一段一个标注），场景变换即新段 |
| 空间标注 | 2D BBox + 估算 depth + objectHeight（非 3D 立方体投影） |
| 模型切换 | Worker 内自动按阶段加载/卸载，对用户透明 |
| 跟踪模式 | YOLO11 逐帧 + ByteTrack 关联 Track ID |
| 细粒度标签 | Qwen3-VL-2B 生成语义属性（hair, clothing, action, scene, camera） |
| 导出格式 | Custom JSON（用户指定格式） + YOLO + COCO |
| 存储 | IndexedDB（图片/帧缓存） + 服务端磁盘（视频 + 标注结果 JSON） |
| 标注集 | 项目下可创建多个标注集（类似数据表） |
| 视频切分 | PySceneDetect 自动 + 人工确认 |

---

## 目录结构（新增）

```
nuwa/
├── app/
│   ├── project/[id]/annotate/          # 项目内标注列表页
│   │   ├── page.tsx
│   │   ├── new/page.tsx                # 新建标注集
│   │   └── [annotateId]/page.tsx       # 标注集详情（视频列表+标注）
│   ├── video-annotation/               # 平台级入口（可选）
│   │   └── page.tsx
│   └── api/video-annotation/
│       ├── tasks/route.ts              # 标注任务 CRUD
│       ├── tasks/[id]/route.ts
│       ├── upload/route.ts             # 视频上传（流式）
│       ├── files/[fileId]/route.ts     # 视频文件服务（Range）
│       ├── segments/route.ts           # 切分 + PySceneDetect 触发
│       ├── segments/[id]/route.ts
│       ├── segments/[id]/annotate/route.ts  # 触发标注
│       ├── segments/[id]/status/route.ts    # Worker 状态轮询
│       ├── worker/health/route.ts      # Worker 健康检查
│       └── export/route.ts            # 导出
│
├── components/video-annotation/
│   ├── AnnotateSetList.tsx             # 标注集列表
│   ├── AnnotateSetCard.tsx             # 标注集卡片
│   ├── VideoBatchUploader.tsx          # 批量上传（拖拽/点击，进度条）
│   ├── VideoMetadataCard.tsx           # 元数据展示（时长/fps/分辨率）
│   ├── VideoPlayer.tsx                 # 视频播放器（视频预览+帧导航）
│   ├── SegmentTimeline.tsx             # 时间轴（显示切分结果）
│   ├── SegmentEditor.tsx               # 片段编辑（修改起止时间、合并拆分）
│   ├── AnnotationCanvas.tsx            # Canvas 画框（view/draw 模式，BBox 渲染）
│   ├── BBoxTable.tsx                   # BBox 列表（显示/隐藏/删除/修改属性）
│   ├── TrackList.tsx                   # Track 列表（Track ID、类别、帧数）
│   ├── TrackEditor.tsx                 # Track 属性编辑（服装、动作、姿态等）
│   ├── AttributeForm.tsx               # 语义属性表单（枚举下拉、文本框）
│   ├── AnnotationDiff.tsx              # 模型/人工差异对比
│   ├── ValidationIssues.tsx            # 校验问题展示
│   ├── ExportDialog.tsx                # 导出格式选择 + 下载
│   └── WorkerStatusBadge.tsx           # Worker 状态指示灯
│
├── services/video-annotation/
│   ├── types.ts                        # 所有类型定义
│   ├── constants.ts                    # 枚举、颜色、默认值
│   ├── store.ts                        # 标注 store（扩展 nuwa store）
│   ├── annotate-service.ts             # 标注集 CRUD
│   ├── upload-service.ts              # 上传逻辑（分片+流式）
│   ├── segment-service.ts             # 切分 + 片段管理
│   ├── worker-client.ts               # Python Worker HTTP 客户端
│   ├── annotation-service.ts          # 标注推理触发 + 轮询
│   ├── canvas-utils.ts                # Canvas BBox 绘制工具函数
│   ├── validation.ts                  # Schema 校验 + 业务规则
│   └── export-service.ts             # JSON / YOLO / COCO 导出
│
├── workers/video-annotation/
│   ├── README.md
│   ├── requirements.txt
│   ├── pyproject.toml
│   ├── app.py                          # FastAPI 主入口
│   ├── config.py                       # 环境变量 + 默认值
│   ├── worker.py                       # 任务调度（接收 job → 按阶段执行）
│   ├── pipeline.py                     # 标注管线编排
│   ├── logging_utils.py
│   ├── services/
│   │   ├── video_metadata.py           # FFprobe 元数据
│   │   ├── scene_detection.py          # PySceneDetect 封装
│   │   ├── frame_sampling.py           # 关键帧抽取
│   │   └── merge_service.py           # 检测+跟踪+语义 结果合并
│   ├── providers/
│   │   ├── detector/
│   │   │   ├── base.py
│   │   │   └── yolo11.py              # YOLO11n 检测
│   │   ├── tracker/
│   │   │   ├── base.py
│   │   │   └── bytetrack.py           # ByteTrack
│   │   ├── semantic/
│   │   │   ├── base.py
│   │   │   └── qwen_vl.py             # Qwen3-VL-2B 语义属性
│   │   ├── grounding/
│   │   │   ├── base.py
│   │   │   └── locate_anything.py     # LocateAnything-3B 细粒度检测
│   │   └── depth/
│   │       ├── base.py
│   │       └── depth_anything.py      # Depth Anything v2
│   └── models/                         # (gitignore)
│
├── data/video-annotations/             # (gitignore)
│   ├── tasks/                          # 任务数据
│   ├── uploads/                        # 上传视频
│   ├── cache/                          # Worker 缓存
│   ├── exports/                        # 导出文件
│   └── temp/                           # 临时文件
│
├── scripts/
│   ├── setup-video-worker.ps1          # 创建 Python venv + 安装依赖
│   ├── start-video-worker.ps1          # 启动 Worker 服务
│   ├── start-all.ps1                   # 一键启动 nuwa dev + Worker
│   └── check-video-environment.ps1     # 环境检查
│
└── .hermes/plans/2026-07-21_video-annotation-plan.md
```

---

# Phase 0：项目分析与准备

## Task 0.1：确认现有代码基线

**目标：** 运行现有 lint/build，确认无回归

**Step 1: Run lint**
```bash
cd D:\dev\projects\nuwa && npm run lint
```
预期：通过（如已有 warning 可忽略）

**Step 2: Run build**
```bash
cd D:\dev\projects\nuwa && npm run build
```
预期：通过

**Step 3: 记录当前 git hash**
```bash
cd D:\dev\projects\nuwa && git rev-parse HEAD
```

---

## Task 0.2：扩展 .gitignore

**文件：** `.gitignore`

追加内容：
```gitignore
# Video annotation
data/video-annotations/
workers/video-annotation/.venv/
workers/video-annotation/__pycache__/
workers/video-annotation/models/
workers/video-annotation/cache/
*.mp4
*.mov
*.avi
*.mkv
*.webm
*.safetensors
*.pt
*.pth
*.onnx
```

---

# Phase 1：类型定义与数据层

## Task 1.1：定义所有 TypeScript 类型

**文件：** `services/video-annotation/types.ts`（新建）

**内容要点：**
- `BBox`：`{ x, y, width, height }`
- `HairInfo`：`{ color, style }`
- `ClothingItem`：`{ type, color, attributes: string[], brand: string | null }`
- `PersonAnnotation`：`{ trackId, personId, gender, ageGroup, hair, expression, pose, action: string[], facing, occlusion, clothing, bbox, depth, objectHeight, keypoints: [] }`
- `ObjectAnnotation`：`{ trackId, name, category, color, brand, bbox, depth, objectHeight }`
- `EventAnnotation`：`{ type, confidence }`
- `SceneAnnotation`：`{ tags, place: { type, indoor, weather, lighting, timeOfDay } }`
- `CameraAnnotation`：`{ shot, angle, movement: string[], lens, stabilization }`
- `SegmentAnnotation`：`{ segmentId, start, end, scene, camera, persons, objects, events }`
- `VideoAnnotation`：`{ video: { videoId, filePath, duration, fps, width, height, description }, annotations: SegmentAnnotation[] }`
- `AnnotateSet`：`{ id, projectId, name, status, videos: VideoTaskItem[], createdAt, updatedAt }`
- `VideoTaskItem`：`{ videoId, fileName, filePath, duration, fps, width, height, status, segments, uploadProgress }`
- `SegmentState`：`{ segmentId, start, end, status: 'draft' | 'confirmed' | 'processing' | 'completed' | 'failed', modelAnnotation?, humanAnnotation? }`
- `AnnotateSetStatus`：枚举，`draft | uploading | splitting | awaiting_segment_review | annotating | validating | awaiting_review | approved | completed | failed | cancelled`
- `WorkerJobStatus`：`{ jobId, status, progress, result?, error? }`
- `ExportFormat`：`'json' | 'yolo' | 'coco'`
- `ApiErrorResponse`：`{ error: { code, message, details?, retryable } }`

---

## Task 1.2：定义 Annotation Store

**文件：** `services/video-annotation/store.ts`（新建）

**内容要点：**
- 扩展 nuwa 现有的 `StoreProvider`，不新建独立 store
- 在 `services/store.tsx` 的 `StoreState` 中新增 `annotateSets: Record<string, AnnotateSet[]>` // key = projectId
- 在 `StoreContextValue` 中新增方法：
  - `getAnnotateSets(projectId: string): AnnotateSet[]`
  - `addAnnotateSet(projectId: string, set: AnnotateSet): void`
  - `updateAnnotateSet(projectId: string, setId: string, updates: Partial<AnnotateSet>): void`
  - `deleteAnnotateSet(projectId: string, setId: string): void`
  - `setAnnotateSets(projectId: string, sets: AnnotateSet[]): void`

---

## Task 1.3：定义常量与枚举

**文件：** `services/video-annotation/constants.ts`（新建）

**内容要点：**
- Canvas 尺寸限制：`CANVAS_MAX_W = 1280, CANVAS_MAX_H = 1024`
- BBox 颜色方案：`BOX_COLORS = ['#FF6CCE', '#CCED68', '#F5B840', '#60A5FA', ...]`
- 上传限制默认值：`MAX_BATCH_FILES = 20, MAX_FILE_SIZE = 2GB, MAX_DURATION_SEC = 3600`
- 切分默认值：`MIN_SEGMENT_SEC = 0.5, DEFAULT_MAX_SEC = 10, OVERLONG_SPLIT_SEC = 8`
- 推理默认值：`SAMPLE_FPS = 0.5, MAX_FRAMES = 8, MAX_NEW_TOKENS = 900, CONFIDENCE_THRESHOLD = 0.5`
- Ontology 枚举：
  - `HAIR_COLORS`, `HAIR_STYLES`, `AGE_GROUPS`, `GENDERS`, `EXPRESSIONS`, `POSES`, `ACTIONS`, `FACING`
  - `CLOTHING_TYPES`, `CLOTHING_COLORS`, `CLOTHING_ATTRIBUTES`
  - `PLACE_TYPES`, `LIGHTING`, `TIME_OF_DAY`
  - `CAMERA_SHOTS`, `CAMERA_ANGLES`, `CAMERA_MOVEMENTS`, `LENS_TYPES`, `STABILIZATION`
  - `EVENT_TYPES`, `OBJECT_CATEGORIES`
- 模型配置：Worker URL、模型名称、默认 provider
- 错误码列表

---

# Phase 2：Python Worker 基础框架

## Task 2.1：创建 Worker 项目骨架

**文件：**
- `workers/video-annotation/pyproject.toml` — 项目元数据 + 依赖
- `workers/video-annotation/requirements.txt` — pip 可安装列表
- `workers/video-annotation/config.py` — 环境变量读取 + 默认值
- `workers/video-annotation/logging_utils.py` — 统一日志格式

**requirements.txt：**
```
fastapi>=0.115
uvicorn[standard]>=0.32
pydantic>=2
torch>=2.4
torchvision>=0.19
transformers>=4.46
accelerate>=1.0
qwen-vl-utils[decord]>=0.0.8
ultralytics>=8.3
scenedetect>=0.6
opencv-python>=4.10
numpy>=2
pillow>=10
json-repair>=0.30
```

**config.py 默认值：**
```env
WORKER_HOST=127.0.0.1
WORKER_PORT=8765
GPU_CONCURRENCY=1
YOLO_MODEL=yolo11n
QWEN_MODEL=Qwen/Qwen3-VL-2B-Instruct
LOCATE_ANYTHING_MODEL=nvidia/LocateAnything-3B
```

---

## Task 2.2：创建 FastAPI 应用骨架

**文件：** `workers/video-annotation/app.py`（新建）

**接口：**
```python
GET  /health          → {"status": "ok", "models_loaded": [...]}
GET  /models           → 可用模型列表及加载状态
POST /jobs             → 提交标注任务 {videoPath, segmentStart, segmentEnd, options}
GET  /jobs/{jobId}     → 获取任务状态 + 结果
POST /jobs/{jobId}/cancel → 取消任务
```

**特性：**
- `lifespan` 中不做模型预加载（惰性加载）
- 只监听 `127.0.0.1`
- CORS 仅允许 localhost
- 任务队列：单 GPU 并发 = 1，多余任务排队

---

## Task 2.3：实现任务队列

**文件：** `workers/video-annotation/worker.py`（新建）

**类：** `JobQueue`
- `submit(job: Job) -> jobId`
- `get_status(jobId) -> JobStatus`
- `cancel(jobId)`
- 持久化到 `data/video-annotations/cache/jobs.json`
- 重启时将 `processing` 任务恢复为 `queued`

---

# Phase 3：Provider 实现

## Task 3.1：YOLO11 Detector Provider

**文件：** `workers/video-annotation/providers/detector/yolo11.py`（新建）

**接口：**
```python
class DetectorProvider(Protocol):
    def load(self) -> None         # 加载模型到 GPU
    def unload(self) -> None       # 卸载释放显存
    def detect_frames(self, frames: list[np.ndarray]) -> list[FrameDetection]
```
`FrameDetection` = `{ frameIndex, detections: [{ bbox: [x,y,w,h], className, confidence }] }`

**实现：**
- 使用 `ultralytics.YOLO("yolo11n.pt")`
- `conf=0.25, iou=0.45`
- 返回 COCO 80 类检测结果

---

## Task 3.2：ByteTrack Tracker Provider

**文件：** `workers/video-annotation/providers/tracker/bytetrack.py`（新建）

**接口：**
```python
class TrackerProvider(Protocol):
    def load(self) -> None
    def unload(self) -> None
    def track(self, detections: list[FrameDetection], segmentId: str) -> list[FrameTrack]
```
`FrameTrack` = `{ frameIndex, tracks: [{ trackId, className, bbox, detectionConfidence, trackingConfidence }] }`

---

## Task 3.3：LocateAnything-3B Grounding Provider

**文件：** `workers/video-annotation/providers/grounding/locate_anything.py`（新建）

**接口：**
```python
def detect_objects(image_path: str, categories: list[str]) -> list[dict]
# returns: [{ className, bbox: [x1,y1,x2,y2], confidence }]
```

**实现：** 复用/改写 VLM-AutoYOLO 的 `locate_anything.py` 核心推理逻辑，去掉 SAM 相关。

---

## Task 3.4：Qwen3-VL Semantic Provider

**文件：** `workers/video-annotation/providers/semantic/qwen_vl.py`（新建）

**接口：**
```python
def annotate_semantic(
    video_path: str,
    frame_paths: list[str],
    start: float,
    end: float,
    ontology: dict,
    prompt_template: str,
    examples: list[dict]
) -> SegmentSemantic
```
`SegmentSemantic` = `{ scene, camera, persons_attributes, objects_attributes, events }`

**实现要点：**
- 使用 `Qwen2_5_VLForConditionalGeneration` + `transformers`
- Decord 读取关键帧
- Prompt 构建：系统角色 + 精简 Guideline + Ontology + Schema + 1-3 Few-shot + 当前帧
- `json-repair` 修复 JSON 格式错误
- 输出仅语义属性，不含 BBox 和 Track ID

---

## Task 3.5：Depth Anything v2 Provider

**文件：** `workers/video-annotation/providers/depth/depth_anything.py`（新建）

**接口：**
```python
def estimate_depth(image_path: str) -> dict
# returns: { depth_map: np.ndarray, mean_depth_meters: float }
def get_object_depth(bbox: BBox, depth_map: np.ndarray) -> float
def estimate_object_height(bbox: BBox, depth: float, focal_length_px: float) -> float
```

**实现：**
- `DepthAnythingV2Small` 模型
- 从 BBox 区域内取中位数深度值
- 用 pinhole model 反推 objectHeight: `height = bbox_height_px * depth / focal_length_px`

---

## Task 3.6：FFprobe Metadata Service

**文件：** `workers/video-annotation/services/video_metadata.py`（新建）

**接口：**
```python
def get_video_metadata(filepath: str) -> VideoMetadata
```
`VideoMetadata` = `{ duration, fps, width, height, codec, bitrate, has_audio }`

**实现：**
- `subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filepath])`
- 解析 JSON 输出

---

## Task 3.7：PySceneDetect Service

**文件：** `workers/video-annotation/services/scene_detection.py`（新建）

**接口：**
```python
def detect_scenes(video_path: str, min_length: float = 0.5, max_length: float = 10.0) -> list[Segment]
```
`Segment` = `{ segmentId, start, end }`

**实现：**
- `ContentDetector(threshold=27)` 检测场景切换
- `AdaptiveDetector` 作为 fallback
- 超长片段（> max_length）继续二分拆分
- 返回 `[start, end)` 列表

---

# Phase 4：标注管线编排

## Task 4.1：实现 Pipeline 编排

**文件：** `workers/video-annotation/pipeline.py`（新建）

**核心流程：**
```python
async def run_annotation_pipeline(
    video_path: str,
    segment: Segment,
    options: AnnotationOptions
) -> SegmentAnnotation:
    # Phase 1: YOLO11 逐帧检测
    detector = YOLO11Detector()
    detector.load()
    frames = sample_frames(video_path, segment, options.sample_fps)
    detections = detector.detect_frames(frames)
    detector.unload()
    
    # Phase 2: ByteTrack 跟踪
    tracker = ByteTrackTracker()
    tracker.load()
    tracks = tracker.track(detections, segment.segment_id)
    tracker.unload()
    
    # Phase 3: LocateAnything-3B 关键帧细粒度检测
    grounding = LocateAnythingGrounding()
    grounding.load()
    keyframe_paths = extract_keyframes(video_path, segment, tracks)
    fine_objects = grounding.detect_objects(keyframe_paths[0], options.categories)
    grounding.unload()
    
    # Phase 4: Qwen3-VL 语义属性
    semantic = QwenVLSemantic()
    semantic.load()
    semantic_result = semantic.annotate_semantic(
        video_path, keyframe_paths, segment.start, segment.end,
        options.ontology, options.prompt_template, options.examples
    )
    semantic.unload()
    
    # Phase 5: Depth Anything 深度估计
    depth_estimator = DepthAnything()
    depth_estimator.load()
    depth_result = depth_estimator.estimate_depth(keyframe_paths[0])
    depth_estimator.unload()
    
    # Phase 6: Merge（合并检测+跟踪+语义+深度结果）
    merged = MergeService.merge(tracks, fine_objects, semantic_result, depth_result)
    
    return merged
```

**每一步完成后写入中间结果到缓存文件**，用于调试和断点恢复。

---

## Task 4.2：实现 Merge Service

**文件：** `workers/video-annotation/services/merge_service.py`（新建）

**职责：**
1. 将 YOLO + ByteTrack 的 Track 与 LocateAnything-3B 的细粒度对象匹配（基于空间重叠 + 类别语义）
2. 将 Qwen3-VL 的语义属性挂载到匹配的 Track 上
3. 将 Depth Anything 的 depth + objectHeight 填入每个 Track 的关键帧
4. 生成最终 `SegmentAnnotation` 结构
5. 匹配失败时标记 `needsReview=true`，未绑定实体保留在结果中

**匹配策略：**
- IoU（Intersection over Union） > 0.3 且类别语义一致 → 匹配
- 一个 Track 匹配一个语义实体
- 无法匹配的 Track → 保留 BBox + TrackId，属性为 `unknown`

---

# Phase 5：Next.js API Routes

## Task 5.1：Worker 健康检查 API

**文件：** `app/api/video-annotation/worker/health/route.ts`（新建）

```typescript
export async function GET() {
  // Proxy to http://127.0.0.1:8765/health
  // Return { status, models_loaded }
}
```

---

## Task 5.2：标注集 CRUD API

**文件：** `app/api/video-annotation/annotate-sets/route.ts`（新建）
**文件：** `app/api/video-annotation/annotate-sets/[id]/route.ts`（新建）

**接口：**
- `GET /api/video-annotation/annotate-sets?projectId=X` → 列表
- `POST /api/video-annotation/annotate-sets` → 创建 `{ projectId, name }`
- `GET /api/video-annotation/annotate-sets/[id]` → 详情
- `PUT /api/video-annotation/annotate-sets/[id]` → 更新
- `DELETE /api/video-annotation/annotate-sets/[id]` → 删除

**存储：** `data/video-annotations/tasks/{id}/task.json`

---

## Task 5.3：视频上传 API（流式）

**文件：** `app/api/video-annotation/upload/route.ts`（新建）

```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // 1. 使用 formidable 流式解析 multipart
  // 2. 边写文件边计算 SHA-256
  // 3. 大小检查（默认 2GB）
  // 4. 扩展名校验（mp4/mov/avi/mkv/webm）
  // 5. 调用 Worker FFprobe 验证
  // 6. 移动到 data/video-annotations/uploads/{videoId}/source.mp4
  // 返回 { videoId, sha256, metadata: { duration, fps, width, height } }
}
```

---

## Task 5.4：视频文件服务 API（Range）

**文件：** `app/api/video-annotation/files/[fileId]/route.ts`（新建）

```typescript
export async function GET(request: Request, { params }: { params: { fileId: string } }) {
  // 1. 校验 fileId 防止路径穿越
  // 2. 读取视频文件
  // 3. 支持 HTTP Range 请求（用于浏览器视频 seek）
  // 4. 返回视频流 + Content-Type + Accept-Ranges
}
```

---

## Task 5.5：切分 API

**文件：** `app/api/video-annotation/segments/route.ts`（新建）
**文件：** `app/api/video-annotation/segments/[id]/route.ts`（新建）

**接口：**
- `POST /api/video-annotation/segments` → `{ videoId }` → 调用 Worker PySceneDetect → 返回 segments 列表
- `PUT /api/video-annotation/segments/[id]` → 修改起止时间、状态
- `DELETE /api/video-annotation/segments/[id]` → 删除片段
- `POST /api/video-annotation/segments/merge` → `{ segmentIds }` → 合并片段
- `POST /api/video-annotation/segments/split` → `{ segmentId, at }` → 拆分片段

---

## Task 5.6：标注推理 API

**文件：** `app/api/video-annotation/segments/[id]/annotate/route.ts`（新建）
**文件：** `app/api/video-annotation/segments/[id]/status/route.ts`（新建）

**接口：**
- `POST /api/video-annotation/segments/[id]/annotate` → 提交标注任务到 Worker
- `GET /api/video-annotation/segments/[id]/status` → 轮询任务状态

**流程：**
```
POST annotate → Next.js → Worker POST /jobs → 返回 jobId → 前端轮询 status
```

---

## Task 5.7：导出 API

**文件：** `app/api/video-annotation/export/route.ts`（新建）

**接口：**
- `POST /api/video-annotation/export` → `{ annotateSetId, format }` → 返回文件流

**支持格式：**
- `json` → 用户指定的 Custom JSON 格式
- `yolo` → ZIP（images + labels）
- `coco` → COCO JSON

---

# Phase 6：前端 UI

## Task 6.1：项目内标注列表页

**文件：** `app/project/[id]/annotate/page.tsx`（新建）

**UI：**
- 标注集列表（卡片形式），显示名称、视频数、状态、进度、创建时间
- "+ 新建标注集" 按钮
- 每个标注集卡片：名称、视频数 x 个、片段数 x 个、状态 tag、进度条、操作按钮（编辑/删除）
- 空状态："还没有标注集，创建第一个开始视频标注"

---

## Task 6.2：新建标注集页

**文件：** `app/project/[id]/annotate/new/page.tsx`（新建）

**步骤：**
1. 输入标注集名称
2. 批量上传视频（`VideoBatchUploader` 组件）
3. 显示上传进度、文件列表、元数据预览
4. "创建" 按钮 → 调用 API → 跳转标注集详情

---

## Task 6.3：标注集详情页（核心）

**文件：** `app/project/[id]/annotate/[annotateId]/page.tsx`（新建）

**布局：**
```
┌────────────────────────────────────────────────────┐
│ ← 返回 │ 标注集名称 │ [自动切分] [启动标注] [导出] │
├────────────┬──────────────────┬────────────────────┤
│ 视频列表   │ 视频播放器        │ 标注面板            │
│            │ (VideoPlayer)    │                    │
│ video1 ✓   │                  │ Scene: [...]       │
│ video2     │ ┌──────────────┐ │ Camera: [...]      │
│ video3     │ │              │ │ Persons:           │
│            │ │   Canvas     │ │  Track 1 [编辑]    │
│            │ │   + BBox     │ │  Track 2 [编辑]    │
│            │ └──────────────┘ │ Objects:           │
│            │                  │  Track 101 [编辑]  │
│            │ ←→ 帧导航        │ Events: [...]      │
│            │                  │                    │
│            │ [时间轴]          │ [保存修改]          │
│            │ ■■■■□□■■■■□□■│                    │
└────────────┴──────────────────┴────────────────────┘
```

---

## Task 6.4：VideoBatchUploader 组件

**文件：** `components/video-annotation/VideoBatchUploader.tsx`（新建）

**功能：**
- 拖拽 / 点击上传
- 文件列表 + 进度条（单个文件 + 总体）
- 多文件并行上传（限制并发数）
- 完成后显示每个文件的 metadata 预览卡
- 支持取消单个上传

---

## Task 6.5：VideoPlayer 组件

**文件：** `components/video-annotation/VideoPlayer.tsx`（新建）

**功能：**
- HTML5 `<video>` 播放器
- 帧前进/后退按钮（单帧步进）
- 当前帧号 / 时间显示
- 播放/暂停
- 支持从 Segment 起止时间跳转

---

## Task 6.6：AnnotationCanvas 组件

**文件：** `components/video-annotation/AnnotationCanvas.tsx`（新建）

**功能（改造自 VLM-AutoYOLO DetectionCanvas）：**
- 渲染当前帧图片
- view 模式：显示所有 BBox（按 Track 分组着色），点击 BBox 选中
- draw 模式：鼠标拖拽画新 BBox / 修改现有 BBox 位置和大小
- BBox 标签显示：`trackId: className`
- 显示 depth 值提示（框角浮动标注）
- 隐藏/显示开关（按 Track 过滤）
- 适配 nuwa 设计 token（gv-* 颜色变量）

---

## Task 6.7：SegmentTimeline 组件

**文件：** `components/video-annotation/SegmentTimeline.tsx`（新建）

**功能：**
- 水平时间轴，标注视频总时长
- 每个 Segment 显示为色块（不同状态不同颜色）
- 当前播放位置指示器
- 点击 Segment 跳转到对应时间
- 当前 Segment 高亮

---

## Task 6.8：TrackEditor 组件

**文件：** `components/video-annotation/TrackEditor.tsx`（新建）

**功能：**
- 展示选中 Track 的详细信息
- 可编辑字段：className, gender, ageGroup, hair, clothing items, pose, action, facing
- 所有枚举字段使用下拉选择
- clothing 支持添加/删除多件
- "保存修改" → 写入 `humanAnnotation`

---

## Task 6.9：ExportDialog 组件

**文件：** `components/video-annotation/ExportDialog.tsx`（新建）

**功能：**
- 选择格式：Custom JSON / YOLO / COCO
- 选择范围：当前标注集 / 选中视频
- 预览按钮（显示将要导出的大致数据结构）
- 下载按钮
- YOLO 导出时显示：images/ + labels/ 目录结构说明

---

# Phase 7：验证与导出

## Task 7.1：Schema 校验

**文件：** `services/video-annotation/validation.ts`（新建）

**功能：**
- 使用 TypeScript 类型守卫验证标注结果
- 检查 BBox 边界（x >= 0, y >= 0, x+width <= videoWidth, y+height <= videoHeight）
- 检查枚举值在 Ontology 范围内
- 检查 confidence 在 0~1
- 导出不含本地绝对路径
- 检查 `modelAnnotation` 和 `humanAnnotation` 分开保存

---

## Task 7.2：Custom JSON 导出

**文件：** `services/video-annotation/export-service.ts`（新建）

**功能：**
- `exportCustomJson(annotateSetId): CustomAnnotationJson` — 生成用户指定格式
- `exportYolo(annotateSetId): Blob` — ZIP 包含 images/ + labels/
- `exportCoco(annotateSetId): Blob` — COCO JSON

**Custom JSON 格式严格按照用户给定的结构：**
```json
{
  "video": { "videoId", "filePath", "duration", "fps", "width", "height", "description" },
  "annotations": [
    {
      "segmentId", "start", "end",
      "scene": { "tags", "place": {...} },
      "camera": { "shot", "angle", "movement", "lens", "stabilization" },
      "persons": [{ "trackId", "personId", "gender", "ageGroup", "hair", "expression", "pose", "action", "facing", "occlusion", "clothing", "bbox", "depth", "objectHeight", "keypoints": [] }],
      "objects": [{ "trackId", "name", "category", "color", "brand", "bbox", "depth", "objectHeight" }],
      "events": [{ "type", "confidence" }]
    }
  ]
}
```

---

# Phase 8：项目布局集成

## Task 8.1：扩展项目布局增加「标注」Tab

**文件：** `app/project/[id]/layout.tsx`（修改）

**修改：** 在 `tabs` 数组中增加：
```tsx
{ label: t('project.annotate'), href: `/project/${id}/annotate` }
```

---

## Task 8.2：扩展 i18n

**文件：** `services/i18n.tsx`（修改）

**新增 i18n key（中英双语）：**
```
'project.annotate': '标注' / 'Annotation'
'annotate.new_title': '新建标注集'
'annotate.no_sets': '还没有标注集'
'annotate.videos_count': '{0} 个视频'
'annotate.segments_count': '{0} 个片段'
'annotate.status.*': 各状态的中英文
'annotate.export_format': '导出格式'
...
```

---

# Phase 9：脚本与环境

## Task 9.1：Windows 环境安装脚本

**文件：** `scripts/setup-video-worker.ps1`（新建）

```powershell
# 创建 Python venv
# pip install -r requirements.txt
# 检查 CUDA 可用性
# 预下载模型（可选，--no-models 跳过）
```

---

## Task 9.2：Windows 启动脚本

**文件：** `scripts/start-video-worker.ps1`（新建）
**文件：** `scripts/start-all.ps1`（新建）

```powershell
# start-video-worker.ps1: 激活 venv + 启动 uvicorn
# start-all.ps1: 启动 Worker + 启动 nuwa dev
```

---

## Task 9.3：环境检查脚本

**文件：** `scripts/check-video-environment.ps1`（新建）

**检查项：**
- Python 3.12+
- CUDA 可用性
- ffmpeg / ffprobe 在 PATH
- 磁盘空间（模型 ~15GB + 视频缓存）
- GPU 显存 ≥ 8GB
- Worker 端口未被占用

---

# Phase 10：验证与回归

## Task 10.1：验证现有功能不受影响

**步骤：**
```bash
npm run lint        # 通过
npm run build       # 通过
```
确认首页、项目列表、数据表、LLM 设置、导出等功能正常。

---

## Task 10.2：端到端测试（手动）

**流程：**
1. `start-all.ps1` 启动
2. 创建项目 → 进入标注 tab → 新建标注集
3. 上传测试视频 → 查看元数据
4. 自动切分 → 确认/调整片段
5. 启动标注 → 等待完成 → 查看结果
6. 修改语义属性、调整 BBox
7. 保存 → 导出 JSON → 验证格式
8. 导出 YOLO → 验证目录结构

---

## 已明确不做（第一阶段）

- 多人协作/用户系统
- 百炼云端 Qwen（默认仅本地）
- RT-DETR / Qwen Grounding / custom detector（默认仅 YOLO11）
- 3D 立方体标注（用 2D BBox + depth）
- Mask 分割（不做 SAM2/SAM3）
- Keypoints / Pose 标注
- 精确人脸识别 / ReID
- COCO / MOT / OpenLABEL（仅 Custom JSON + YOLO + COCO）
- Parquet 格式导出
- 规范在线编辑器（Phase 1 用硬编码的默认 Schema）

---

# 已知风险与注意事项

1. **GPU 显存限制（8GB）：** 4 个模型按阶段串行加载，每次只占一个模型的内存。OOM 降级策略：YOLO11n（~0.5GB）→ Qwen3-VL 2B（~4GB at BF16）→ LocateAnything-3B（~6GB at BF16）→ Depth Anything v2 Small（~1GB）
2. **Qwen3-VL 速度：** 2B 模型 + 0.5fps + 8帧，每个 segment 约 15-30 秒。4B 更快但显存不够
3. **LocateAnything-3B 速度：** 每个关键帧 3-5 秒，仅关键帧跑，一个 segment 需要 ~10-15 秒
4. **PySceneDetect 准确性：** 依赖视频内容，暗场景/淡入淡出可能漏切或误切
5. **Worker 稳定性：** Python 进程崩溃后任务队列需可恢复
6. **大视频上传：** 必须流式写入，不能 `request.formData()` 全读入内存
7. **视频文件存储：** `data/video-annotations/` 可能快速增长，需要提示用户磁盘使用
8. **LocateAnything-3B 需要 HF_TOKEN：** 模型 gated，需要用户在 .env 中配置
