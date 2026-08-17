# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary user:** 个人开发者/研究者（WingYouther），本地 Windows 环境使用。
- **场景：** 构造结构化合成数据集 + AI 辅助视频标注审核。单用户、本地优先。
- **语言偏好：** 中文为主，UI 同时支持中/英切换。
- *（以上基于项目 README 描述 "trusted local or internal use" 和代码中 `lang="zh-CN"` 默认值推断，待用户确认）*

## Product Purpose

Nuwa 是一个本地优先的智能合成数据与视频标注工作台。做两件事：

1. **合成数据** — 通过可视化 schema 编辑器 + LLM 辅助，快速生成结构化测试/训练数据集，支持 9 种列类型、8 种 ID 格式、6 种导出格式和关系表引用。
2. **视频标注** — 批量上传视频 → 自动 ML Pipeline 预处理（YOLO→ByteTrack→LA-3B→Qwen3-VL→TrOCR→Whisper→Depth→Merge）→ 人工审核/修正 → 导出 COCO/YOLO/Custom JSON。

成功标准：一人能在本地完整跑通"视频上传 → AI 预处理 → 人工修正 → 数据集导出"的闭环，无需云端依赖。

## Positioning

与 Label Studio / CVAT 的差异：

- **内置 AI Pipeline 而非外挂：** 标注工具直接驱动 YOLO、ByteTrack、Qwen3-VL、Whisper 等模型的本地推理，不是把标注界面接上外部 ML 后端。
- **合成数据 + 标注一体化：** 同一个工具既能生成训练数据，又能标注真实视频。Label Studio / CVAT 只管标注不管合成。
- **本地优先、零云依赖：** 元数据存浏览器 localStorage，数据存本地文件系统，Worker 跑本地 conda 环境。不需要 Docker、K8s、云存储。
- *（以上基于 README 架构描述和与 Label Studio/CVAT 的标准功能差异推断，待用户确认）*

## Operating Context

- **运行环境：** Windows 11，Next.js 16 (dev/start)，Python Worker 通过 conda 环境启动（`D:\dev\runtimes\conda\envs\yolo\python.exe`）
- **GPU：** NVIDIA GeForce RTX 5060 Laptop GPU，8GB VRAM — ML 推理受显存约束
- **工作流：** 浏览器打开 → 上传视频 → Worker 自动处理 → 浏览器审核标注 → 导出
- **存储：** 无传统数据库 — 元数据存 `localStorage`，视频 job 存 `data/video-annotations/tasks/`，Parquet 存 `generated_data/`，配置存 `configs/`
- **开发命令：** `npm run dev`、`npm run build`、`npm run test`（含 node test + worker test + typecheck）

## Capabilities and Constraints

### 合成数据
- 9 列类型：text, number, boolean, date, ID, phone, city, foreign key, foreign key array
- 8 ID 格式：UUID v4/v7, Snowflake, auto-increment, CUID2, MongoDB ObjectId, Nano ID, ULID
- 6 导出格式：JSON, CSV, XLSX, XML, SQL INSERT, Parquet
- LLM 辅助：OpenAI/Anthropic 兼容 API 生成文本值和 number/date 生成器代码
- 关系表：scalar 或 array 外键引用其他表
- 中/英 UI 切换

### 视频标注
- 批量上传，UTF-8 文件名，持久化 file-backed jobs
- 8 阶段 Pipeline：YOLO 检测 → ByteTrack 追踪 → LA-3B 定位 → Qwen3-VL 语义 → TrOCR 文字 → Whisper 语音 → Depth 深度 → Merge 合并
- Canvas 编辑器 + 场景导航 + 时间轴
- Custom JSON / COCO / YOLO ZIP 导出
- Scene detection + Manual Split 草稿片段
- 人物身份管理（合并/拆分/锁定）

### 技术约束
- 仅 Windows 开发/运行
- 无数据库 — 并发和查询能力受限
- ML 推理受 8GB VRAM 限制
- 未配置 CI/CD，本地跑测试
- *（以上基于代码和已有记忆核实）*

## Brand Commitments

- **名称：** Nuwa（女娲）— 中国神话中的创世女神，“捏土造人”隐喻从原始素材创造出结构化数据/标注。
- **正式产品界面：** 专业、克制、高信息密度，保持清晰层级和适度呼吸感；避免大面积留白、拥挤排布、过宽内容列和重复卡片墙。
- **颜色：** 正式页面以纯白背景为统一画布，`#FFADD1` 作为柔和芭乐粉品牌色，仅用于标识、图标底和轻强调；需要承载白色文字的主操作使用更深的玫瑰色，确保可读性。低饱和叶绿色只用于辅助入口与正向语义，文字采用带粉调的柔和石墨色。禁止荧光感、过量粉色、毛玻璃、AI 紫色光晕和无意义渐变。
- **字体与密度：** Geist / 系统无衬线用于界面，固定 12/14/16/18/20/24px 产品字号，4px 间距网格；数据和代码使用等宽字体。
- **动效：** 仅用于反馈、状态变化和理解操作结果，统一使用非线性缓动；只动画 `transform` 与 `opacity`，必须支持 `prefers-reduced-motion`。
- **设计基准：** 正式产品页面以已确认的 `/design-demo` 方案 A 布局语言和正式首页色彩语言为准。`design-model.yaml` 是后续页面迁移的设计系统来源；Demo 在全部正式页面验证完成前保留。

## Evidence on Hand

- **README.md / README.zh-CN.md：** 完整的项目描述和架构文档
- **PROJECT_STATUS_AND_ISSUES.md：** 详细的问题跟踪（35+ 已解决的 issue，P0-P3 优先级体系）
- **package.json：** 依赖和脚本
- **概念原型：** `demo/new-ui/concept2.html` — 视频标注工作区的三栏布局设计稿
- **缺失：** 无正式 logo、无品牌手册、无对外网站/域名、无用户研究数据 — 后续工作不可编造

## Product Principles

1. **本地优先，零摩擦启动** — 用户打开浏览器就能用，不需要 Docker、云服务、数据库配置。
2. **AI 辅助而非替代** — Pipeline 给出初始结果，人工审核/修正才是最终权威；不追求全自动。
3. **一体两面** — 合成数据生成和视频标注是两个工作区，共享同一套工具链和设计语言。
4. **精确优于花哨** — Canvas 标注支持帧级编辑、原子化操作、可撤销；视觉动效服务于可用性而非装饰。
5. **中文原生** — 默认中文界面，但保留英文作为第二语言支持。

## Accessibility & Inclusion

- 当前无显式的无障碍要求（ARIA、键盘导航、屏幕阅读器支持待评估）
- *（基于代码中未发现无障碍相关实现推断）*
