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

- **批量视频上传**，并以本地文件持久化标注任务
- **场景感知处理**，在模型推理前完成视频分段
- **可选本地模型提供者** — YOLO11、LocateAnything、Qwen3-VL、TrOCR、Whisper 和 Depth Anything
- **基于 IoU 的跟踪**，关联处理帧中的目标
- **人工审核**，包含画布编辑器、场景导航和时间轴
- **自定义 JSON、COCO 和 YOLO ZIP 导出**，包含标签和关键帧图像

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

> **Worker 配置：** 各脚本现在共用同一个 Python 解析器，并可加载 `workers/video-annotation/worker.env`。复制 `worker.env.example`、选择安装配置，并把 `HF_TOKEN` 保留在进程环境或密钥管理器中；脚本不会持久化该令牌。

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
| `/api/video-annotation/upload` | 上传源视频 |
| `/api/video-annotation/files/*` | 读取视频并提取指定时间点的视频帧 |
| `/api/video-annotation/segments/*` | 检测场景并提交片段标注任务 |
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
| `QWEN_LOCAL_MODEL` | 本地 Qwen 模型标识 |
| `QWEN_LOCAL_MODEL_PATH` | 本地 Qwen 模型目录，优先于 `QWEN_LOCAL_MODEL` |
| `DEPTH_MODEL` | Depth Anything 模型标识或本地路径 |
| `NUWA_PROVIDER_*` | 启用或禁用单个视频模型提供者 |
| `NUWA_WORKER_PYTHON` | 所有 Worker 脚本统一使用的 Python 解释器 |
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
| `npm run setup` | 创建项目运行时目录 |
| `./scripts/check-video-environment.ps1` | 检查本地视频 Worker 环境 |
| `./scripts/setup-video-worker.ps1 -Profile full` | 安装可选择的 Worker 依赖配置（基础、单提供者或完整） |
| `./scripts/start-video-worker.ps1` | 启动视频 Worker |
| `./scripts/start-all.ps1` | 同时启动 Worker 和 Next.js 开发服务器 |

当前没有自动化测试命令，也没有检入单元测试或集成测试套件。

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

- `trackId` 保持数字类型，用于表示视频范围内的轨迹。片段内 tracker 先保证同一帧的一对一关联，再由持久化的视频级注册表完成局部 ID 重映射，之后才进入深度、结果合并、审核和导出。
- 同一片段重新标注时会复用已保存的映射。只有时间相邻、类别一致且边界框重叠达到高置信度的一对一轨迹才会跨片段延续；无法确认时分配新 ID，避免把两个不同人物错误合并。
- `personId` 由视频级轨迹身份生成（`<videoId>:person:<trackId>`）。Qwen 的性别、年龄、头发和服装等语义属性不再用于哈希人物身份，因为不同人物可能具有相同描述。
- 身份注册表位于 `data/video-annotations/cache/video-identities/`。如果需要 Worker 重启后仍保持稳定 ID，应将该缓存与任务数据一起保留。现有已保存标注不会被自动改写；重新标注片段后才会使用新规则生成 ID。
- 该策略是保守的轨迹身份关联，不宣称具备跨镜头生物特征 ReID。人物在硬切镜头或长时间离开后再次出现时可能获得新身份，这比静默合并两个不同人物更安全。

请使用与 Worker 相同的 Python 解释器运行重点回归测试：

```powershell
cd workers/video-annotation
python -m unittest discover -s tests -v
```

## 安全与部署说明

- 女娲在可信本机环境中仍可免密码使用。在共享网络上提供服务时，同时设置 `NUWA_AUTH_USER` 和 `NUWA_AUTH_PASSWORD` 即可启用 HTTP Basic 身份认证；项目不提供按用户划分的权限控制。
- 会修改状态的 API 请求会拒绝跨站浏览器来源。
- LLM API Key 保存在本地 JSON 文件中。请保护宿主机文件系统，不要提交运行时配置。
- Worker 脚本不包含访问令牌。共享设置页面可以在配置的 Hugging Face 缓存中校验并持久化 Token，单独授权不会启动模型下载；远程部署仍应优先使用 Secret Manager 和 HTTPS，并轮换任何曾被写入仓库或共享副本的旧令牌。
- 自定义和 LLM 生成的值由受限、无副作用的表达式解释器执行。它保留已记录的行/引用/随机数/Math/Date 辅助能力，但不允许语句、赋值、全局访问或动态代码执行。
- LLM 请求允许公共 HTTP(S) 服务以及 Ollama 等回环服务；内网端点必须显式加入 `NUWA_LLM_ALLOWED_PRIVATE_HOSTS`。
- API 路径参数会经过校验，并限制在各自的数据根目录内；目录穿越式名称会被拒绝。
- 视频、视频帧、模型权重、缓存和数据集可能占用大量磁盘空间。
- 部署基于文件的服务端组件时需要使用持久化卷。

## 当前限制

- 视频标注模块仍在持续开发；提供者行为还取决于上游模型实现、FFmpeg 以及可用的 CPU/GPU 内存。
- Python 依赖采用有上下界的兼容范围，而非完全可复现的锁文件；需要特定 CUDA 版本时，应先安装对应的 PyTorch 构建。
- 受限 Hugging Face 模型需要在共享设置页面完成一次授权，或由部署环境通过 `HF_TOKEN` 提供凭据；模型准备是独立的显式操作，并会在下载前报告缓存/本地模型路径。
- 服务端会将上传视频缓冲到内存，大文件可能消耗大量内存。
- 名为 `ByteTrackTracker` 的跟踪器仍使用保守的 IoU 匹配，并非完整的 ByteTrack；视频身份注册表修复了 ID 作用域和不安全的重复分配，但不能替代生产级 ReID 模型。
- Worker 重点回归测试已经覆盖轨迹身份和抽帧错误，但尚无完整的浏览器/API 端到端测试及数据迁移测试套件。
- 当前没有传统数据库、多人协作、按用户划分的权限控制或通用迁移系统。

## License

MIT
