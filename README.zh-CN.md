# 女娲 (Nuwa) — 智能合成数据平台

[English](README.md)

女娲是一个本地优先的工作台，用于创建结构化合成数据集和审核 AI 辅助生成的视频标注。项目结合了可视化模式编辑器、可配置的 LLM 数据生成、关系型数据导出，以及可选的 Python 推理 Worker。

项目主要面向可信的本地或内部环境。合成数据项目的元数据保存在浏览器中，生成文件、视频任务和模型配置则保存在本地文件系统中。

## 功能特性

### 合成数据

- **9 种列类型** — 文本、数字、布尔、日期、ID、电话、城市、外键和外键数组
- **8 种 ID 格式** — UUID v4/v7、Snowflake、自增 ID、CUID2、MongoDB ObjectId、Nano ID 和 ULID
- **6 种导出格式** — JSON、CSV、XLSX、XML、SQL INSERT 和 Parquet
- **LLM 辅助生成** — 使用兼容 OpenAI 或 Anthropic 的 API 生成文本值及数字/日期生成代码
- **关系型模式** — 通过单值或数组外键列引用其他数据表
- **可视化编辑与统计** — 调整列顺序、预览数据行并查看生成结果的分布
- **生成数据持久化** — 将表数据保存为服务端 Parquet 文件
- **中英双语界面** — 可在浏览器中切换合成数据工作区的语言

### 视频标注

- **批量视频上传**，支持 UTF-8 文件名、文件化持久任务和项目内单视频删除
- **场景感知处理**，在模型推理前完成视频分段
- **可选本地模型提供者** — YOLO11、LocateAnything、Qwen3-VL、RapidOCR、Whisper 和 Depth Anything；Qwen 语义阶段也可单独切换到远程多模态 API
- **ByteTrack 跟踪**，包含 Kalman 预测、高低置信度两阶段关联，并保留可配置的旧 IoU 回退
- **人工审核**，包含画布编辑器、场景导航和时间轴
- **自定义 JSON、COCO 和 YOLO ZIP 导出**，包含标签和关键帧图像；自定义 JSON 可选择加入人工修正后的 OCR 与语音文字

## 整体架构

```text
浏览器
├── Next.js 页面和 React 组件
├── localStorage 中的合成数据项目状态
└── 视频审核与画布标注状态
        │
        ▼
Next.js 服务端
├── LLM 配置及 OpenAI/Anthropic 请求代理
├── Parquet 持久化、恢复和下载
├── 视频上传与流式读取
└── 基于文件的视频标注任务 API
        │
        ├──────────────► 兼容 OpenAI 或 Anthropic 的 LLM 服务
        │
        ▼
Python 视频 Worker（可选，默认 127.0.0.1:8765）
├── 使用 FFmpeg/FFprobe 处理场景与视频帧
├── 检测、视觉定位、OCR、语音、深度和 VLM 提供者
└── 本地模型文件 / Hugging Face 下载
```

### 浏览器层

`app/` 下的页面负责渲染应用。项目页和数据表页通过 `services/` 中的模块编辑模式、生成数据行、展示统计信息并导出数据集。`services/store.tsx` 使用浏览器 `localStorage` 持久化项目元数据。

视频审核功能主要位于 `components/video-annotation/`。它通过 Next.js API 加载文件系统中的任务，并使用 React 保存当前编辑状态。

### Next.js 服务端层

`app/api/` 下的路由处理器负责保存 LLM 配置、代理生成请求、读写 Parquet 数据、接收和读取视频、管理标注集，以及将视频片段任务转发给 Python Worker。

### Python Worker 层

`workers/video-annotation/` 是独立的 FastAPI 服务，负责媒体处理和本地模型推理。合成数据工作区无需启动该服务；自动视频处理则需要 Worker、FFmpeg，以及已启用模型提供者所需的依赖。

## 存储模型

女娲目前没有使用传统数据库。

| 数据 | 存储位置 | 主要实现 |
|---|---|---|
| 项目、数据表和标注集元数据 | 浏览器 `localStorage` 的 `nuwa-store` 键 | `services/store.tsx` |
| 界面语言 | 浏览器 `localStorage` 的 `nuwa-lang` 键 | `services/i18n.tsx` |
| LLM 设置 | `configs/llm-config.json` | `app/api/llm/config/route.ts` |
| 生成代码缓存 | `configs/code-cache.json` | LLM/代码生成服务 |
| Parquet 输出 | `generated_data/{projectId}/{tableName}.parquet` | `app/api/data/`、`services/parquet.ts` |
| 视频任务元数据 | `data/video-annotations/tasks/{id}/task.json` | 标注集 API |
| 视频和 Worker 产物 | `data/video-annotations/` | 视频 API 和 `workers/video-annotation/` |

基于文件的存储更适合单个本地服务进程。多实例部署需要外部持久化服务和并发控制。

## 核心流程

### 合成数据流程

```text
创建/打开项目
  → 定义数据表和列
  → 创建空白预览行
  → 逐列生成配置的数据
  → 按需调用 /api/llm
  → 检查数据和统计结果
  → 导出所选格式
```

浏览器通过 `services/data-gen.ts` 和 `services/code-gen.ts` 编排生成过程。文本列通过 `/api/llm` 直接调用已配置的 LLM；数字和日期提示词可以要求 LLM 生成值表达式。保存的数据行通过 `/api/data` 写入 Parquet；JSON、CSV、XLSX、XML 和 SQL 则在浏览器中生成。

### 视频标注流程

```text
上传视频
  → 创建并持久化标注任务
  → 通过 Next.js API 请求处理
  → 将任务发送给 Python Worker
  → 探测视频信息并划分场景
  → 运行已安装的模型提供者
  → 保存视频帧和模型输出
  → 在浏览器中审核/编辑标注
  → 导出 JSON、COCO 或 YOLO ZIP
```

每个模型提供者都是可选的。任务只能使用 Worker 环境中依赖和模型权重均已就绪的提供者。

自动场景检测完成且尚未开始标注时，片段审核页支持 **Manual Split**。选择一个草稿片段后，可通过播放、拖动进度条、前后帧按钮或时间输入定位切点，预览左右两个新范围，再按视频 FPS 吸附后的边界进行分割。第一阶段会在该视频任一片段已经产生模型或人工结果后禁用此操作，因此不会清空已完成的审核内容。

## 技术栈

| 范畴 | 技术 |
|---|---|
| Web | Next.js 16、React 19、TypeScript |
| 样式与 UI | Tailwind CSS 4 和项目内 React 组件 |
| 数据导出 | parquetjs、JSZip 和浏览器端导出器 |
| 视频 Worker | Python、FastAPI、Uvicorn |
| 媒体处理 | FFmpeg、FFprobe、Pillow |
| 可选 AI | PyTorch、Ultralytics YOLO 和基于 Transformers 的提供者 |
| 持久化 | 浏览器 `localStorage` 和本地 JSON/二进制文件 |

## 快速开始

### Web 应用

环境要求：

- 推荐使用 Node.js 20 或更高版本
- npm

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

### 配置 LLM（可选）

打开应用中的 **Settings**，配置兼容 OpenAI 或 Anthropic 的服务提供者、模型、接口地址和 API Key。确定性生成器不依赖外部模型。

### 配置视频语义模型（可选）

Settings 中的“视频标注 · 语义模型”与合成数据 LLM 配置相互独立，默认保持 **本地 Qwen**，因此没有外部 API 也可继续按原方式运行。主动切换为 **Remote API** 并保存后，Worker 才会停止加载本地 Qwen，并把最多三张按时间排序的压缩画面发送给指定的 OpenAI/Anthropic 兼容多模态模型。存在检测 Track 时，画面会带有 `P<trackId>`/`O<trackId>` 标记框，使返回属性能够绑定明确 Track；没有 Track 时仍使用普通场景关键帧。YOLO、ByteTrack、OCR、Whisper、Depth、LocateAnything、人工审核和导出均不受影响。

远程视觉连接测试只会在用户点击“测试视觉连接”时发送一张很小的测试图片，且不会保存配置或启用 Remote 模式，用户仍需明确点击“保存配置”；自动化测试不会访问外部 API。远程模式会向第三方传输视频关键帧，启用前应确认数据权限、服务条款和费用。

### 创建数据集

创建一个项目，并添加一个或多个数据表。

### 定义数据表和列

配置每列的类型和生成器。外键列可以引用其他数据表。

### 生成与导出

创建预览行，生成所需列，然后检查生成数据和统计结果。

生产环境运行方式：

```bash
npm run build
npm run start
```

## 视频 Worker 配置

额外环境要求：

- Python 3.12 或更高版本
- FFmpeg 和 FFprobe 已加入 `PATH`，或已显式配置路径
- 有足够的磁盘空间存放上传视频、视频帧、模型权重和缓存
- 对于资源消耗较高的本地模型，建议使用支持 CUDA 的 GPU

仓库中的辅助脚本面向 Windows PowerShell：

```powershell
./scripts/check-video-environment.ps1
./scripts/setup-video-worker.ps1
./scripts/start-video-worker.ps1
# 也可以同时启动 Worker 和 Next.js 开发服务器：
./scripts/start-all.ps1
```

如需单独启动 Web 应用，请运行 `npm run dev`。

`setup-video-worker.ps1` 会创建 `workers/video-annotation/.venv`；启动和环境检查脚本只使用这个 Nuwa 专用解释器，不再回退到当前激活的 Conda/base 环境，因此不会通过修改 Worker 依赖影响其他项目。`NUWA_WORKER_PYTHON` 仅用于显式指定另一个 Nuwa 专用解释器。

当前已验证的 Windows/NVIDIA 环境可使用以下命令安装完整配置：

```powershell
./scripts/setup-video-worker.ps1 -Profile full `
  -TorchIndexUrl https://download.pytorch.org/whl/cu132 `
  -TorchVersion 2.13.0+cu132 `
  -TorchvisionVersion 0.28.0+cu132
```

CPU 部署可省略三个 PyTorch 参数；其他 GPU 应选择与驱动匹配的下载索引和版本。LocateAnything 所需的 Transformers 已固定为 `4.57.1`。

> **Worker 配置：** 脚本可以加载 `workers/video-annotation/worker.env`。复制 `worker.env.example`、选择安装配置，并把 `HF_HOME` 指向持久化缓存，以复用已有模型权重。Hugging Face 可在共享设置页连接一次，也可由部署环境通过 `HF_TOKEN`/密钥管理器提供。除非显式传入 `-DownloadModels`，安装不会下载模型权重。

## 列类型

| 类型 | 用途 |
|---|---|
| `text` | 根据 LLM 提示词直接生成值 |
| `number` | 执行自定义或 LLM 生成的无副作用表达式，无配置时回退为随机值 |
| `boolean` | 按可配置的真值比例生成 `1` 或 `0` |
| `date` | 使用日期分布、自定义表达式或 LLM 生成表达式 |
| `id` | 使用八种格式之一生成唯一 ID |
| `phone` | 生成指定国家/地区的电话号码 |
| `city` | 生成指定国家的城市名称 |
| `foreign_key` | 引用其他已生成数据表中的一行 |
| `foreign_key_array` | 引用其他数据表中的多行 |

## 导出格式

JSON · CSV · Excel (XLSX) · XML · SQL INSERT · Parquet

视频标注还可以导出为自定义 JSON、COCO JSON，或包含标签、类别和可用关键帧图像的 YOLO ZIP。

## API 概览

### Next.js API

| 路由 | 职责 |
|---|---|
| `/api/llm/config` | 读取和保存 LLM 服务设置 |
| `/api/llm` | 代理兼容 OpenAI 或 Anthropic 的生成请求 |
| `/api/data` | 读取、写入、计数和删除数据表的 Parquet 数据 |
| `/api/data/download` | 下载数据表的 Parquet 文件 |
| `/api/data/fk-values` | 为外键生成加载已保存的数据行 |
| `/api/restore/tables` | 发现服务端可恢复的 Parquet 数据表 |
| `/api/video-annotation/annotate-sets/*` | 创建、恢复、轮询、更新和删除标注集 |
| `/api/video-annotation/annotate-sets/{id}/videos/{videoId}` | 永久删除一个空闲视频及其片段/标注、上传目录和身份缓存 |
| `/api/video-annotation/upload` | 上传源视频 |
| `/api/video-annotation/files/*` | 读取视频并按时间戳或帧索引提取图像，相邻帧缓存键互不冲突 |
| `/api/video-annotation/annotate-sets/{id}/frames` | 持久化单个片段的帧级空间编辑 |
| `/api/video-annotation/annotate-sets/{id}/frames/manual-track` | 在任务文件锁内原子分配并保存一个人工 Person/Object Track |
| `/api/video-annotation/annotate-sets/{id}/person-analysis` | 排队并轮询一个明确选中 Person 框的仅预览语义分析 |
| `/api/video-annotation/annotate-sets/{id}/segments/split` | 在按 FPS 吸附的时间点原子分割一个未标注草稿片段 |
| `/api/video-annotation/segments/*` | 检测场景并提交片段标注任务 |
| `/api/video-annotation/semantic/config` | 读取和保存独立的视频语义 Local/Remote 配置，不返回 API Key |
| `/api/video-annotation/semantic/test` | 通过 Worker 显式测试远程多模态请求与语义 JSON 响应 |
| `/api/video-annotation/worker/health` | 检查 Worker 健康状态 |

FastAPI Worker 提供健康检查、任务状态和处理接口，由 Next.js 服务端调用。默认地址为 `http://127.0.0.1:8765`。

## 环境变量

| 变量 | 用途 |
|---|---|
| `WORKER_HOST` | Worker 监听地址，默认为 `127.0.0.1` |
| `WORKER_PORT` | Worker 端口，默认为 `8765` |
| `VIDEO_ANNOTATION_WORKER_URL` | Next.js 服务端使用的 Worker URL，默认为 `http://127.0.0.1:8765` |
| `GPU_CONCURRENCY` | GPU 密集型任务的最大并发数 |
| `VIDEO_ANNOTATION_DATA_ROOT` | Worker 数据根目录；Next.js 视频 API 当前固定使用 `data/video-annotations` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | 显式指定媒体工具路径 |
| `SCENE_THRESHOLD` | Worker 场景检测阈值 |
| `YOLO_MODEL` | YOLO 模型名称或路径 |
| `LOCATE_ANYTHING_MODEL` | LocateAnything 模型设置 |
| `LOCATE_MAX_SIDE` / `LOCATE_MAX_NEW_TOKENS` | LocateAnything 视觉输入和响应上限，默认分别为 `1024` 与 `512` |
| `LOCATE_GENERATION_MODE` | LocateAnything 生成模式；`hybrid` 保持默认精度路径，可选 `fast` 但复杂场景质量可能下降 |
| `LOCATE_CATEGORY_MODE` | 精细定位任务的类别策略：默认 `adaptive`，也可设为 `full` |
| `LOCATE_ADAPTIVE_MAX_CATEGORIES` / `LOCATE_ADAPTIVE_GENERATION_MODE` / `LOCATE_ADAPTIVE_MAX_NEW_TOKENS` | 自适应精细定位的边界，默认分别为 `18`、`fast` 和 `256` |
| `QWEN_LOCAL_MODEL` | 本地 Qwen 模型标识 |
| `QWEN_LOCAL_MODEL_PATH` | 本地 Qwen 模型目录，优先于 `QWEN_LOCAL_MODEL` |
| `NUWA_VIDEO_SEMANTIC_CONFIG` | 视频语义配置文件路径；默认使用 `configs/video-semantic-config.json` |
| `DEPTH_MODEL` | Depth Anything 模型标识或本地路径 |
| `NUWA_PROVIDER_*` | 启用或禁用单个视频模型提供者 |
| `NUWA_TRACKER_BACKEND` | 跟踪后端，默认 `bytetrack`，可设为 `iou` 使用旧回退 |
| `TRACK_LOW_THRESHOLD` / `TRACK_HIGH_THRESHOLD` / `TRACK_MATCH_THRESHOLD` / `TRACK_BUFFER` | ByteTrack 置信度、关联和丢失轨迹保留参数 |
| `TRACKING_SAMPLE_FPS` / `TRACKING_FRAME_BATCH_SIZE` | 检测/跟踪采样率与有界解码批大小，默认分别为 `3` FPS 和 `4` 帧 |
| `NUWA_PERSON_REID` | 是否启用轻量 CPU 人物外观匹配，默认为 `true` |
| `PERSON_REID_MODEL_PATH` | 可选的本地 YoutuReID ONNX 路径；留空时复用 Hugging Face 缓存，不存在才下载一次 |
| `PERSON_REID_MATCH_THRESHOLD` / `PERSON_REID_MAX_GAP_SECONDS` | 保守的外观相似度阈值与跨片段最大搜索间隔，默认分别为 `0.82` 和 `30` 秒 |
| `NUWA_WORKER_PYTHON` | 所有 Worker 脚本统一使用的 Python 解释器 |
| `NUWA_TORCH_INDEX_URL` / `NUWA_TORCH_VERSION` / `NUWA_TORCHVISION_VERSION` | 可选的安装期 GPU wheel 来源与精确 PyTorch 版本 |
| `HF_TOKEN` | 可选的 Hugging Face 访问令牌 |
| `HF_HOME` / `HF_HUB_CACHE` | Hugging Face 缓存位置 |
| `NUWA_AUTH_USER` / `NUWA_AUTH_PASSWORD` | 可选的 HTTP Basic 凭据；在共享网络上提供女娲服务时应同时设置 |
| `NUWA_LLM_ALLOWED_PRIVATE_HOSTS` | 允许作为内网 LLM 端点的精确主机名/IP，多个值用逗号分隔；回环地址始终自动允许 |

修改 Worker 监听地址或端口时，请在 Next.js 进程中把 `VIDEO_ANNOTATION_WORKER_URL` 设置为对应的可达地址。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动 Next.js 开发服务器 |
| `npm run build` | 创建生产构建 |
| `npm run start` | 启动生产服务器 |
| `npm run lint` | 运行 ESLint |
| `npm run typecheck` | 只执行 TypeScript 类型检查，不生成文件 |
| `npm test` | 运行 Node 回归、Worker 单元测试和 TypeScript 检查 |
| `npm run test:node` | 运行流式上传和模型结果保存回归测试 |
| `npm run test:worker` | 使用项目本地 Python 环境运行 Worker 单元测试 |
| `npm run setup` | 创建项目运行时目录 |
| `./scripts/check-video-environment.ps1` | 检查本地视频 Worker 环境 |
| `./scripts/setup-video-worker.ps1 -Profile full` | 安装可选择的 Worker 依赖配置（基础、单提供者或完整） |
| `./scripts/start-video-worker.ps1` | 启动视频 Worker |
| `./scripts/start-all.ps1` | 同时启动 Worker 和 Next.js 开发服务器 |

`npm test` 是不执行真实模型推理的统一回归入口，覆盖流式上传、UTF-8 文件名、超限/中断清理、安全单视频删除、模型重跑保留人工标注、Provider 状态、ByteTrack 两阶段关联、跨片段 ReID/身份协调、OCR、语义解析、远程 OpenAI/Anthropic 图片请求结构和结果合并。调用真实模型或真实远程 API 的完整浏览器/API 流程仍需独立媒体夹具和用户配置。

## 项目结构

```text
nuwa/
├── app/
│   ├── api/
│   │   ├── data/                    # Parquet 持久化与下载
│   │   ├── llm/                     # LLM 配置和生成请求代理
│   │   ├── restore/                 # 发现可恢复的服务端数据
│   │   └── video-annotation/        # 上传、标注集、片段和 Worker API
│   ├── project/[id]/
│   │   ├── table/                   # 表模式、数据生成、统计和导出
│   │   └── annotate/                # 标注集列表和编辑器
│   ├── restore/                     # Parquet 恢复页面
│   ├── settings/                    # LLM 设置页面
│   ├── layout.tsx                   # 根布局
│   └── page.tsx                     # 项目列表首页
├── components/
│   ├── video-annotation/            # 上传、画布、播放、审核和导出 UI
│   └── LangToggle.tsx               # 语言切换器
├── services/
│   ├── data-gen.ts                  # 逐列生成编排
│   ├── code-gen.ts                  # ID、日期、电话/城市数据和表达式执行
│   ├── export.ts                    # JSON、CSV、XLSX、XML 和 SQL 导出器
│   ├── llm.ts                       # 浏览器端 LLM API 客户端
│   ├── parquet.ts                   # 服务端 Parquet 持久化
│   ├── stats.ts                     # 生成数据统计
│   ├── store.tsx                    # 浏览器项目状态
│   └── video-annotation/            # 视频类型、Worker 客户端、画布和导出器
├── workers/video-annotation/
│   ├── providers/                   # 检测、跟踪、VLM、OCR、音频和深度
│   ├── pipeline.py                  # 处理流水线
│   ├── services/                    # 场景检测、视频身份及视频帧/视频工具
│   ├── tests/                       # Worker 重点回归测试
│   ├── worker.py                    # 进程内任务队列
│   └── app.py                       # FastAPI 入口
├── scripts/                         # 运行时配置和 Windows Worker 辅助脚本
├── configs/                         # LLM 设置和生成代码缓存
├── generated_data/                  # Parquet 输出
├── data/video-annotations/          # 上传、任务、缓存、导出和临时数据
├── package.json                     # Web 脚本与依赖
└── README.zh-CN.md                  # 中文文档
```

## 轨迹与人物身份

- `trackId` 保持数字类型，但只作为片段内的空间与编辑键；不同片段出现相同数值是正常的，同一片段或采样帧内的同类实体则不能重复该键。`personId` 是独立的视频级人物身份，用于跨片段识别同一个人。
- 检测/跟踪现在默认独立按 `3 FPS` 采样，并以每批四帧的方式解码；Pipeline 根据批内位置统一写入绝对帧序号，并拒绝结果数量不完整的检测批次，不再信任 Provider 自行维护的索引。Qwen/Remote API 最多接收三张以 Track 覆盖率选择的标记跟踪帧，因此语义关联不再受旧 `0.5 FPS` 选项限制，同时内存占用仍有边界。
- 空间框现在保存在 `SegmentAnnotation.frames[]` 中，每项包含帧索引、时间戳、图像尺寸、实体类型、Track ID、置信度、来源和 bbox。原有片段级 `persons`/`objects` 继续作为语义与兼容摘要，因此已有任务仍能打开和导出。
- 审核页的播放器、提取帧和 Canvas 由同一个采样帧驱动；帧步进使用视频 FPS 或已保存的采样时间戳，不再写死 30 FPS。每次进入 Draw 都必须明确选择 Person 或 Object，选择 Object 后还必须手动填写标签。人工框改由服务端在任务文件锁内分配 Track；每个片段保存单调递增计数，删除后也不复用旧编号；人工 Person 创建时会立即获得视频内唯一的 `personId`。选择、移动、缩放、撤销和删除仍按“帧 + 实体类型 + Track ID”隔离。删除默认只移除当前帧的框，所有帧都不再观察到该实体时才移除兼容摘要。
- 选中框后可以在 Person 与 Object 之间双向转换。`Convert This Frame` 是默认的低风险操作；`Convert Entire Track` 需要二次确认，并在一次带锁保存中更新该视频已标注片段里匹配的视频级身份观察。Person→Object 必须手动填写物体标签，转换会保留 bbox、Track ID、时间戳和未受影响的语义属性。
- 物体标签纠错现在默认限定到当前帧。`Save This Frame Label` 只修改当前选中采样帧的 observation，不改片段摘要、相邻帧、整条 Track 或片段 Event；当前帧 JSON 会优先采用该人工帧标签并单独重算视觉 Event。`Save Entire Track` 与 `Apply Label to Matching Objects` 仅作为需要确认的显式扩大范围操作，分别用于确实需要整轨修正和 Track 断裂的情况；后者可以读取保留的原始模型标签，但不会硬编码任何类别。批量操作继续排除 OCR 标签。
- 审核页会分别显示当前采样帧和完整片段中的 Person、非 OCR Object 与 OCR 数量；实体进入或离开画面时，两组数量本来就不一定相等。人物 Canvas 标签优先显示紧凑的视频身份（`P-…` 或 `P-M…`），片段 Track 编号作为次级审核信息保留。对于历史数据中“同一个低位 Track ID 同时携带普通物体与 `_textContent`”的污染，读取任务时会执行幂等迁移：只有相邻时间、边界框高 IoU 且候选唯一时才把普通框恢复到已有 Track，OCR 则从保留的模型结果恢复到百万 ID 命名空间；候选不明确时绝不自动合并。
- 固定 revision 的轻量 YoutuReID ONNX 模型（106,878,407 字节，约 102 MiB）在 CPU 上为每条人物轨迹提取最多三张代表性裁剪。相邻片段通过保守的一对一外观相似度或边界 IoU 延续；同片段重跑会先保留兼容的已存映射，人物 embedding 明确冲突时否决位置回退，证据不充分时仍允许强 IoU 维持召回。乱序身份别名还必须具有兼容的历史人物外观，并继续拒绝曾共同出现的身份。
- ReID 只是身份辅助，不是必需标注 Provider。权重缺失或推理异常时会回退到边界 IoU，不会把片段标成降级完成，也不会占用 Qwen 或 LocateAnything 使用的 GPU 显存。
- `personId` 由视频级轨迹身份生成（`<videoId>:person:<trackId>`）。Qwen 的性别、年龄、头发和服装等语义属性不再用于哈希人物身份，因为不同人物可能具有相同描述。
- 人物/物体自动语义补全现在只按数值 `trackId` 绑定，不再按照模型返回数组的顺序猜测。Local Qwen 与 Remote API 的返回 ID 必须存在于可见标记 Track 清单中；缺失、格式错误、重复或虚构的 ID 不会被写到其他实体。本地 Qwen 现在会直接解析结构化或文本形式的 hair、action、clothing、expression、pose 与 facing，并支持粉、蓝、紫、银等非写实发色，不再把 JSON 对象先转成字符串或把已支持字段固定成 `unknown`。如果结果中恰好只有一个 Person Track、结构化发色为空，同时同一响应明确出现“`<颜色> hair`/`<颜色>-haired`”，才允许补入该空发色；多人场景因归属不明确而禁止使用这个兜底。该路径已在视频 `ms47m6em49tkge` 的 S3 完成真实验证：持久化人物保持原身份，并得到 `gender=female`、`hair.color=pink`、`hair.style=ponytail`。片段重跑还会把该片段已有的人工 Person/Object 框放入仅供语义分析的 Track 副本，因此即使 YOLO 没有重新检出该实体，也能按原 `trackId/personId` 回填人工卡片。人工框不会混入检测/跟踪结果；返回建议只补 `unknown`/空字段，已有人工值、身份、bbox、深度和遮挡比例继续优先，内部建议字段在持久化与导出前移除。
- 身份注册表位于 `data/video-annotations/cache/video-identities/`。如果需要 Worker 重启后仍保持稳定 ID，应将该缓存与任务数据一起保留。旧 schema v1 注册表会在下一次身份分配时先在内存中迁移为 v2，保留 `nextTrackId`、片段映射和已有全局 ID，再通过原子写入持久化。现有标注不会自动重新推理，外观 embedding 只会在对应片段重跑后补充。当后续证据安全合并两个 ID 时，API 会把规范 `personId` 同步到该视频已保存的模型与人工标注，但不会改动其他人工审核字段。
- 仅靠外观的 ReID 无法保证人物换装、严重遮挡或超出配置时间窗口后的身份一致。模糊匹配会保守地保持分裂；人工合并/拆分与身份置信度仍是后续审核能力。

请使用与 Worker 相同的 Python 解释器运行重点回归测试：

```powershell
cd workers/video-annotation
python -m unittest discover -s tests -v
```

## Provider 输出契约

- Qwen 分类值只进行精确匹配或完整单词/短语匹配，因此 `female` 不会再因子串包含关系被归类为 `male`；`young` 和 `middle` 等短年龄输出通过显式别名处理。
- Qwen 提示词不再包含可能被复读成误检结果的具体物体或事件示例，并明确要求视觉证据。Qwen 可以补充检测器已确认物体的属性，但没有定位证据的 Qwen 单独物体不会作为确定对象导出，也不能覆盖检测器给出的类别名称。
- YOLO 检测使用 `None` 表示采用配置中的置信度/IoU 默认值。显式传入的 `iou=0.45`、`iou=0.0` 或 `conf=0.0` 都会被保留。
- RapidOCR 在 CPU 上对片段起始、中间和结束三张完整关键帧执行文字检测与中英文识别，重复文字会去重并保留置信度最高的像素边界框；为兼容现有配置，历史 `trocr` Provider ID 仍然有效。
- Whisper 识别到语音时返回 `{"text": "..."}`，不再生成虚假的固定置信度，也不返回带时间戳的 `segments`；推理失败会与“正常执行但没有语音”明确区分。
- 新产生的片段结果包含 OCR 和语音的内部 `_recognition` 状态（`completed`、`no_content`、`no_audio`、`disabled`、`skipped` 或 `failed`）；即使没有识别文字，审核页面也会展示执行状态。
- LocateAnything 现在声明所需的 Transformers、PEFT、Decord 和 LMDB 版本。缺包或版本不匹配时，Provider 状态会返回 `missing_dependency` 或 `incompatible_dependency`，而不是错误显示为 `ready`，模型准备也会在下载权重前被阻止。Worker 继续复用配置的 Hugging Face 缓存，这些 Python 运行库不会复制模型权重。
- LocateAnything 使用受支持的 PyTorch SDPA 注意力路径。缺少可选的 FlashAttention 或 MagiAttention 时会给出性能警告并自动回退到可运行的 SDPA，不代表标注失败。
- 配置的本地 LocateAnything 快照包含 NVIDIA 官方优化 hybrid 执行器时，Worker 会自动使用；不可用时自动回退原有 `generate()` 路径。默认 1024 像素输入上限与该执行器保持一致，类别提示使用模型官方的 `</c>` 分隔符，日志会分别记录模型加载与 grounding 耗时。检测类别、合并规则和导出 JSON 字段均未改变。
- 普通“标注”“重新运行片段”“全部重新运行”和失败片段重试都会在每个 Worker 任务中显式跳过 LocateAnything；其他 Provider、OCR、语音、跟踪、审核和导出行为保持不变。片段审核工具栏新增“精细定位”，只为当前选中的片段启用 LocateAnything。后端仅在完整增强模式已启用且模型已就绪时接受该请求，避免界面显示精细定位、实际却静默跳过。
- 片段任务状态会记录当前或最近一次完成的是标准标注还是精细定位；这只是页面运行信息，不改变标注或导出 JSON 结构。重新运行仍只更新 `modelAnnotation`，不会覆盖人工审核副本。
- 新 pipeline 结果包含 `_provider_statuses`。启用的核心视觉 Provider（YOLO、tracker、LocateAnything 或 Qwen）失败或缺少必需输入时会保留其他可用结果，但片段、视频和标注项目均显示为 `partial_completed`；Qwen 推理异常和无效响应不再被转换为空结果并错误显示成功。主动禁用的 Provider 不会导致降级，检测阶段确实没有目标而使 tracker 跳过则视为正常空结果。审核页会提示降级状态并允许定向重标；包含已知核心 Provider 错误的历史 `completed` 结果，在读取时也会归一化为该状态。
- 语音识别结果在内部保存在顶层 `speechTranscript` 字段中，不再作为视觉 Event。页面读取标注时会兼容迁移历史 `[Speech] ...` 条目；OCR 仍在内部保存为带定位框的文字对象。两者继续用于人工审核和视频总结证据，默认不写入 Custom JSON，也可以在导出时主动选择加入。
- 视觉 Event 由固定 `type` 和一句简短的 `description` 组成，只概括画面中可见的活动。Qwen 会在较长的人物/物体数组之前输出这两个字段，降低输出截断导致 Event 缺失的概率；若语义 Event 缺失或因未定位物体声明被过滤，系统只根据已定位人物、已识别动作和已定位非文字物体生成一条 `visual_activity` 兜底概括。
- “Segment Data Review”替代了原先以大段原始文本为主的内部编辑器，默认把片段概览、场景/镜头、人物、物体、Event、OCR/语音和采样帧分组展示，支持折叠与字段/内容搜索。片段编号和时间范围始终来自当前选中的外层片段，因此只包含内层语义的 Worker 标注不会再显示 `S?`/`undefined`，Raw JSON 也不能保存与真实片段冲突的编号或范围。“Raw JSON (Advanced)”仍保留完整片段编辑，并增加格式化、重置和保存前结构校验。仅用于运行诊断的 `_recognition`、`_pipeline_errors`、`_provider_statuses` 和 `_pipeline_status` 继续保存在内部任务数据中，但不会出现在可编辑或导出的标注 JSON 中；一次性的 `_identity_aliases` 会由 API 消费且不持久化。已有 `events: []` 的历史标注会在审核页和 Custom JSON 导出时使用同一套基于已定位证据的视觉兜底；只有需要重新执行模型识别时才需要重跑片段。
- 场景、相机、人物、服装、物体和 Event 的人工审核选项均提供“自定义…”入口；选择后可直接输入任意标签字符串，不改变现有标注字段结构。布尔字段仍保持固定选项，遮挡比例可输入 0–1 范围内的任意数值。
- “片段文字与语音”区域中的每条 OCR 和语音转写都可以直接修改并保存为人工标注。OCR 修正会同步更新文字对象名称，历史语音 Event 会迁移到 `speechTranscript`；清空错误 OCR 后保存会删除该文字对象，清空语音输入则会清除人工转写，并且人工清除结果不会再次回退显示原模型误识。
- 重新运行片段只更新 `modelAnnotation`，不再删除已有 `humanAnnotation`。审核页面继续优先显示人工确认版本，同时单独保留新的模型输出和诊断信息。
- 已保存的历史片段结果不会被自动重写。需要对受影响片段手动执行一次“重新运行片段”，才能生成 RapidOCR 结果和新的识别状态；现在打开片段时，视频播放器也会自动定位到该片段的开始时间。

## 视频标注导出

- Custom JSON 中的 `video.description` 现在按时间顺序读取全部可用片段的场景、已定位人物/物体、视觉事件、OCR 与语音上下文，由 **Settings** 中配置的通用 OpenAI/Anthropic 兼容 LLM 生成一句视频级总结；长视频会先按时间线分块概括，再归并为最终一句话。
- 生成视频描述不会重新运行视频 Worker，也不会下载额外视觉模型。未配置通用 LLM 或调用失败时，导出仍会使用原有的本地确定性概括并在页面提示已回退。
- Custom JSON 会把场景、镜头、人物、服装、物体和 Event 类型等本体标签值统一为小写 `snake_case`；自然语言描述、品牌、路径和 ID 保持原值。
- Custom JSON 序列化器兼容字段不完整的历史或人工编辑标注：缺失的单值本体标签导出为 `unknown`，缺失的可选天气保持 `null`，空缺的数组项会被忽略，不再中断文件下载。
- Custom JSON 默认不输出 `speechTranscript`、OCR 文字对象和 `frames`；这些数据仍保留在内部标注和审核页面中。导出弹窗提供可选的 **Include OCR & Speech** 开关，开启后会加入人工审核后的 OCR 文字对象和片段级 `speechTranscript`，但仍不会输出 `frames` 与运行诊断字段。“Export Current Frame JSON”使用独立的单帧序列化器，只包含 `frameIndex`、`timestamp`、规范化后的片段场景/镜头上下文、该采样帧真正可见的人物/物体，以及根据这些实体重新生成的视觉 Event；不会继承其他帧物体、片段语音/OCR、完整 `frames` 集合或旧片段 Event。
- “导出当前片段 JSON”只下载当前选中的片段，但外层 `video.description` 仍概括整个视频，并使用相同的 OCR/语音开关；“导出全部标注”继续保留原有 JSON、YOLO ZIP 和 COCO 导出流程。该选项只影响 Custom JSON，不改变 YOLO 或 COCO 输出。
- 场景语义仍以片段（`S1`、`S2`……）为单位，空间框则按检测/跟踪采样帧保存。没有 `frames` 的历史标注仍可读取；编辑当前显示的旧框时会建立明确的帧记录。系统不会声称对未采样的全部编码帧执行过推理。
- “Segment Data Review”仍表示整片段内部数据，其中可能包含全部采样帧、OCR 和语音；采样帧分组默认折叠以减少审核干扰，不等同于当前帧导出。
- 新 OCR 对象使用从 `1000000` 开始的保留 Track ID 命名空间，并在分配前扫描所有检测 ID，避免 OCR 文字继承或覆盖视觉物体 Track。

## 失败片段恢复

- 失败片段支持通过复选框逐个选择，也可以使用“全选失败片段”，然后点击“重新标注已选”只提交选中的子集；原有单片段重试和全部重新运行功能继续保留。
- 标注任务文件的更新现已串行化，状态轮询不会再用旧快照覆盖刚提交的新 Worker Job ID。Worker 中确实不存在的作业会明确提示 Job ID 已过期并建议重试，不再只显示裸 `HTTP 404`。
- 标准重试不会运行 LocateAnything。只有在确实需要额外 grounding 时，才进入选中片段并点击“精细定位”；若完整增强模式尚未就绪，接口会返回明确错误且不会排入一个名不副实的标准任务。

## 安全与部署说明

- 女娲在可信本机环境中仍可免密码使用。在共享网络上提供服务时，同时设置 `NUWA_AUTH_USER` 和 `NUWA_AUTH_PASSWORD` 即可启用 HTTP Basic 身份认证；项目不提供按用户划分的权限控制。
- 会修改状态的 API 请求会拒绝跨站浏览器来源。
- 合成数据和视频语义的 API Key 分别保存在被 Git 忽略的本地 JSON 配置中，两个业务不会互相覆盖；接口只返回 `hasApiKey`。请保护宿主机文件系统，不要提交运行时配置。
- Worker 脚本不包含访问令牌。共享设置页面可以在配置的 Hugging Face 缓存中校验并持久化 Token，单独授权不会启动模型下载；远程部署仍应优先使用 Secret Manager 和 HTTPS，并轮换任何曾被写入仓库或共享副本的旧令牌。
- 自定义和 LLM 生成的值由受限、无副作用的表达式解释器执行。它保留已记录的行/引用/随机数/Math/Date 辅助能力，但不允许语句、赋值、全局访问或动态代码执行。
- LLM 请求允许公共 HTTP(S) 服务以及 Ollama 等回环服务；内网端点必须显式加入 `NUWA_LLM_ALLOWED_PRIVATE_HOSTS`。
- API 路径参数会经过校验，并限制在各自的数据根目录内；目录穿越式名称会被拒绝。
- 视频、视频帧、模型权重、缓存和数据集可能占用大量磁盘空间。
- 部署基于文件的服务端组件时需要使用持久化卷。

## 当前限制

- 视频标注模块仍在持续开发；提供者行为还取决于上游模型实现、FFmpeg 以及可用的 CPU/GPU 内存。
- **LocateAnything 兼容性修复（2026-07-26 已完成真实验证）：** Nuwa 已固定 Transformers `4.57.1`、PEFT `0.19.1`、Decord `0.6.0` 和 LMDB `1.7.5`，使用隔离 Worker 环境，选择 SDPA 而非不受支持的 eager 注意力路径，在报告就绪前检查依赖，并显示降级完成状态。真实运行了 0–8 秒的 `S1`，YOLO、跟踪、LocateAnything、Qwen、OCR、语音和深度阶段全部完成，`_provider_statuses.locate_anything` 与 `_pipeline_status` 均为 `completed`。
- 在已验证的 8GB Windows GPU 上，LocateAnything 的 SDPA/hybrid 路径仍可能耗时数分钟并接近显存上限，因此它改为按片段主动启用，而不再进入普通标注。自适应类别和有边界的 fast-first 路径用于减少精细任务的预期工作量，但本次没有对该路径给出新的真实模型速度结论；需要优先完整性时仍可设置 `LOCATE_CATEGORY_MODE=full`。
- 已检查的历史 `ign` 任务是在 LocateAnything 对 62 个片段全部失败期间生成的。现在读取任务会把这些结果显示为 `partial_completed`，但不会自动重写模型标注；重启 Worker 后需对选中的受影响片段执行重新标注。
- 检测质量仍受 `yolo11n` 和 `0.65` 置信度阈值限制。跟踪已改为独立的 `3 FPS` 采样，但 Qwen 继续采用保守策略，没有定位证据的 Qwen 单独物体会被丢弃；较小、短暂、遮挡或非 COCO 目标仍可能漏识。
- 极短场景片段仍可能得不到检测帧。自适应中点帧兜底、短片段治理、Qwen 候选证据平衡以及 YOLO 模型/阈值基准测试仍属待办，详见 `PROJECT_STATUS_AND_ISSUES.md` 的 P1-6。
- Transformers、LocateAnything 远程代码的直接依赖以及已验证的 Windows CUDA PyTorch 构建使用精确版本；其余部分 Python 依赖仍采用有上下界的兼容范围，而非完整的传递依赖锁文件。
- 受限 Hugging Face 模型需要在共享设置页面完成一次授权，或由部署环境通过 `HF_TOKEN` 提供凭据；模型准备是独立的显式操作，并会在下载前报告缓存/本地模型路径。
- 视频上传现在按 UTF-8 解析 multipart 文件名参数，直接读取请求流，通过有上限的临时文件增量写盘并计算哈希；中断、无效或超限请求会清理临时上传目录。自动化测试已用小型流验证内存有界的处理方式，生产部署仍建议补做一次 2GB 规模的内存压力测试。
- 项目视频卡片提供永久删除操作，确认后会移除任务记录、源视频/缩略图目录和视频身份缓存；仍有片段标注任务运行的视频会被拒绝删除，需等待任务结束。当前没有回收站或撤销功能。
- 默认 Tracker 使用 Ultralytics ByteTrack 的 Kalman 预测和高低置信度两阶段关联，之后再执行轻量跨片段外观匹配。这不是生物特征身份认证：永久身份别名现在要求兼容的历史 embedding，但外观十分相似的人物仍可能混淆，保守阈值也仍可能把同一人物拆成多个 ID。
- 既有人工 Person 如果缺少 `personId`，会在任务下次读取时获得彼此独立的视频级人工身份；该迁移不会猜测不同片段中的人物是否为同一个人，也不会改写模型身份或语义字段。
- 正常 Pipeline 会自动为检测 Track 以及片段重跑时已有的人工框填充语义。人物审核面板的 **Analyze Selected Person** 继续作为“不重跑整段”、模型仍保守返回 `unknown` 或用户主动定向重试时的显式预览补救；它提取当前选中帧，只裁剪该 bbox 并保留少量上下文，再通过原有顺序 Worker 队列调用本地 Qwen 或已配置的视频语义 Remote API。候选结果只包含可编辑人物属性，不携带或修改身份、Track、bbox、场景、Event、物体和导出数据。**Fill Empty Fields** 只在本地编辑器中补充 `unknown`/空字段，保留已有人工值与遮挡值；用户审核候选并点击 **Save Changes** 前不会写入任务文件。
- `npm test` 已提供统一的 57 个 Node/84 个 Worker/类型检查回归入口，并覆盖显式语义 Track 绑定、人物外观结构化解析、单人物描述一致性安全兜底、人工审核候选仅进入语义副本、拒绝位置回退、身份注册表迁移、人工 Track 原子分配与删除后不复用、旧人工人物身份补齐、重复键拒绝、片段审核权威元数据、帧级人物/物体隔离、框边界约束/更新以及 Worker 帧数据保留；目前仍缺少调用真实模型的完整浏览器端到端测试，以及面向其他未来 schema 的通用迁移框架。
- 当前没有传统数据库、多人协作、按用户划分的权限控制或通用迁移系统。

## License

MIT
