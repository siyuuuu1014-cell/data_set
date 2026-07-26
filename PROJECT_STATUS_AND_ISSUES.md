# Nuwa 已解决问题与待办优先级

> 更新日期：2026-07-26
> 适用范围：当前工作区中的 Nuwa 合成数据模块、视频标注前端、Next.js API 和 Python Worker。  
> 状态说明：本文以当前代码为准；“已解决”表示已有实现，“部分解决”表示已有界面或基础设施但仍存在已知缺陷，“待解决”表示尚未完成。2026-07-23 已完成 P0-1～P0-4 的代码修复和重点回归验证；P0-5 的仓库侧扫描已完成，第三方后台撤销旧密钥仍需部署者操作。2026-07-26 已完成 P0-6 的隔离环境、直接依赖固定、兼容性状态、SDPA 加载和降级完成状态，并通过一个真实片段验证；P0-7 已修正 Qwen/Tracker 失败与主动禁用场景的 Pipeline 状态判定；P1-2～P1-4 已完成流式上传、人工结果保护、真实 ByteTrack 接入和统一回归入口；R20 已把 LocateAnything 从普通任务中移出，并提供按片段精细定位入口；R21 已在不关闭规则的前提下清零全项目 ESLint 错误和警告。规模与真实视频验收项单独保留。工作区目前包含未提交改动，后续提交前应再次运行完整验证。

## 1. 优先级定义

| 优先级 | 含义 | 处理原则 |
| --- | --- | --- |
| P0 | 数据错误、安全泄露、核心流程崩溃或无法确认标注身份 | 立即处理，完成前不应扩大使用范围 |
| P1 | 明显影响主要功能、准确率、稳定性或资源占用 | 当前迭代处理 |
| P2 | 不阻塞核心流程，但影响部署、维护、安全纵深或结果质量 | 后续迭代处理 |
| P3 | 代码整理、体验细节和长期工程化 | 有计划地清理 |

## 2. 已解决的问题

### R1. 两类业务在前端布局中混在一起

- **状态：已解决**
- 已把“合成数据”和“视频标注”作为两个独立工作区展示，同时保留原有配色和视觉风格。
- 共享页头根据当前路由切换业务入口，不再把视频标注作为合成数据项目内部的一项功能。
- 相关实现：`components/WorkspaceHeader.tsx`、`app/page.tsx`、`app/annotations/page.tsx`。
- **回归要求：** 两个入口、项目列表和设置入口都可正常访问；合成数据的原有创建、生成和导出能力不得受影响。

### R2. 两个工作区的新建按钮和右上角状态不一致

- **状态：已解决**
- 合成数据和视频标注的“新建项目”按钮已放在对应页面一致的位置。
- 合成数据工作区右上角显示 LLM 配置状态；视频标注工作区显示 Worker 状态；设置入口保持通用。
- 相关实现：`components/WorkspaceConfigStatus.tsx`、`components/WorkspaceHeader.tsx`。
- **回归要求：** 切换工作区后状态来源随之切换，不能在视频页面显示 LLM 状态代替 Worker 状态。

### R3. 视频标注缺少“项目 → 多个视频 → 单视频管理”层级

- **状态：已解决**
- 已支持先创建视频标注项目，再在项目内持续添加多个视频。
- 项目页展示视频卡片；点击单个视频后再进入该视频的切分、标注和管理流程。
- 相关实现：`app/annotations/page.tsx`、`app/annotations/[annotateId]/page.tsx`、`app/annotations/[annotateId]/videos/[videoId]/page.tsx`。
- **回归要求：** 新项目可以为空；进入已有项目后可以分批追加视频；每个视频的数据和片段不能串到其他视频。

### R4. 片段已完成但项目首页仍显示草稿/状态不一致

- **状态：已解决**
- API 获取项目时会轮询 Worker，把完成结果同步到片段，并通过统一状态派生逻辑计算视频与项目状态。
- 相关实现：`app/api/video-annotation/annotate-sets/[id]/route.ts`、`services/video-annotation/status.ts`。
- **回归要求：** Worker 完成后，片段、单视频页、视频项目页和视频项目列表的状态最终一致；失败和部分结果应正确展示错误信息。

### R5. 部署者必须每次启动前手动设置 `HF_TOKEN`

- **状态：已解决**
- 用户可以在共享设置页面输入 Hugging Face Token，由后端校验并交给 `huggingface_hub` 的本地凭据机制管理。
- 环境变量仍可用于服务器/容器的 Secret Manager，并且优先于页面管理的凭据。
- Token 不在 API 响应中返回，也不应写入仓库、`worker.env` 或日志。
- 相关实现：`components/video-annotation/VideoDeploymentSettings.tsx`、`app/api/video-annotation/auth/`、`workers/video-annotation/services/hf_auth.py`。
- **回归要求：** 页面只显示连接状态和用户名，任何响应及日志都不能包含 Token 原文。

### R6. 授权后自动重复下载已存在的模型

- **状态：已解决基础流程**
- Hugging Face 授权与模型准备已经拆分：保存 Token 不触发下载；仅当部署者主动选择完整增强模式并确认准备模型时才下载。
- Worker 会检查 Hugging Face 缓存或配置的本地模型路径，并使用下载锁避免多进程重复下载。
- 相关实现：`workers/video-annotation/providers/registry.py`、`workers/video-annotation/services/hf_auth.py`、`app/api/video-annotation/deployment/`。
- **回归要求：** 已缓存模型应报告实际路径且不重复下载；改变 `HF_HOME` 后必须明确显示新的缓存位置；下载中不得重复提交同一任务。

### R7. 基础模式与完整增强模式没有清晰边界

- **状态：已解决基础流程**
- 已区分标准模式与增强模式；只有主动启用增强能力时才要求受限模型授权和模型准备。
- Provider 支持按配置启停，并按阶段依次加载、使用和卸载，避免模型同时长期占用显存。
- 相关实现：`workers/video-annotation/providers/registry.py`、`workers/video-annotation/pipeline.py`、`workers/video-annotation/worker.env.example`。

### R8. 启动方式和 Worker Python 环境不统一

- **状态：已解决**
- 启动脚本共享 Python 解析和 `worker.env` 加载逻辑，支持单独启动 Worker 或同时启动前端和 Worker。
- 当前主要命令：

```powershell
.\scripts\start-video-worker.ps1
.\scripts\start-all.ps1
```

- 环境诊断命令：

```powershell
.\scripts\check-video-environment.ps1
```

### R9. 已发现的路径、Token 和 Worker 管理接口安全问题

- **状态：已完成主要加固**
- 已加入路径安全校验、上传扩展名和大小校验、Worker 管理操作保护、LLM URL/SSRF 校验，以及敏感值不回传机制。
- **仍需外部操作：** 曾经暴露过的 Hugging Face Token 或 LLM API Key 必须在对应平台后台撤销/轮换；代码无法使旧 Token 自动失效。

### R10. Qwen 性别子串匹配和 YOLO IoU 默认值覆盖

- **状态：已解决**
- **完成日期：** 2026-07-24
- Qwen `_pick()` 已改为精确或完整单词/短语匹配，`female` 不会再命中 `male`；`young`、`middle` 使用显式年龄别名，避免修复性别后引入年龄识别回归。
- YOLO `iou` 参数改用 `None` 作为默认值 sentinel，显式传入 `0.45` 不再被替换为配置值；`conf` 同步改为严格的 `None` 判断，因此显式 `0.0` 也不会被覆盖。
- 新增 4 个 Provider 回归测试，覆盖女性分类、年龄短别名、显式 IoU 和配置默认值。

### R11. Whisper 返回结构与 docstring 不一致

- **状态：已解决**
- **完成日期：** 2026-07-24
- 初始修复先让 docstring 与旧实现一致；在后续识别链路修复中，已移除写死的 `confidence=0.9`。Whisper 现在识别成功时返回 `{"text": "..."}`，失败会进入结构化错误状态，正常无语音则返回空结果。
- 当前生成路径不产生时间戳 `segments`，页面也不再把固定数值展示成真实置信度。

### R12. 中文字幕 OCR 无结果且页面无法区分未识别与失败

- **状态：已解决**
- **完成日期：** 2026-07-24
- 原 `microsoft/trocr-small-printed` 只适用于裁剪后的单行文字，项目却把完整关键帧直接送入模型，并使用不匹配的 tokenizer，因此无法可靠识别中文字幕。
- 保留历史 `trocr` Provider ID 以兼容配置，内部替换为 RapidOCR 的 ONNX CPU 流程，对完整关键帧执行文字检测、方向分类和中英文识别；结果保留真实边界框与 OCR 置信度。
- 第二轮验证发现管线只识别 `keyframe_paths[0]`，片段开始时尚未出现、但中后段可见的字幕仍会漏检。现已改为识别片段起始、中间和结束三张关键帧，并对重复文字去重、保留最高置信度结果。
- OCR 和语音新增 `_recognition` 执行状态，区分成功、无内容、无音轨、禁用、跳过和失败；Provider 异常不再被吞掉并伪装为空结果。
- 审核页始终展示 OCR/语音状态，语音不再显示写死的 90%；编辑场景、相机或 JSON 时会保留 OCR 和语音内部结果。
- 视频播放器会在切换片段时跳转到当前 Segment 开始时间。
- 历史保存结果不会自动迁移或重新推理；需要手动重新运行受影响片段，才会写入 RapidOCR 结果和 `_recognition` 状态。本次修复过程未运行真实视频推理。

### R13. 导出描述只来自首个片段且不能单独导出当前片段

- **状态：已解决**
- **完成日期：** 2026-07-24
- 根因是审核页的 `generateVideoDescription()` 直接读取 `segs[0]`，后续片段完全没有参与 `video.description` 生成。
- R13 当时先实现了遍历全部片段的确定性模板摘要，解决“只读首片段”和描述过长问题；R19 已在此兼容回退之上增加真正的视频级 LLM 语义总结，因此当前正常路径不再只是关键词拼接。
- 审核页新增“导出当前片段 JSON”，只导出当前选中的 `S` 片段；原有“导出全部标注”的 JSON、YOLO ZIP 和 COCO 功能保持不变。
- 当前数据模型以场景片段为持久化单位，并未保存视频编码层面的逐帧完整 JSON；因此这里的单项导出是单个 Segment，而不是任意原始帧。

### R14. Qwen 提示词复读导致不同视频反复出现 `butterfly`

- **状态：已解决**
- **完成日期：** 2026-07-24
- 根因不是任务缓存跨视频串用，而是旧 Qwen 提示词在物体说明、事件说明和完整 JSON 示例中多次写入 `butterfly`；2B 模型会复读这些具体实体。当前《复仇者联盟》任务中的错误对象均为 `bbox: null`，部分事件与旧示例原文完全一致。
- 新提示词已移除所有具体物体/事件示例，要求只报告有明确视觉证据的内容，不确定时使用空列表或 `unknown`。
- 合并层不再把没有 YOLO/grounding 定位证据的 Qwen 单独物体加入确定对象列表；依赖这些未确认物体的事件也会丢弃。
- 检测器类别名称不再被 Qwen 改写，并删除了 `bird` 与 `butterfly`/`insect` 的错误同义映射。
- 已保存的旧任务结果不会被自动改写，需要重新运行受影响片段后才会清除旧幻觉；本次验证未运行真实视频推理。

### R15. 批量标注出现 `HTTP 404` 且失败片段无法多选重试

- **状态：已解决**
- **完成日期：** 2026-07-24
- 本次 `ign` 任务的 22 个失败片段仍保存第一组已经失效的 Worker Job ID，而 Worker 中同片段的第二组作业实际已经完成。根因是提交接口、轮询接口和保存接口同时对整个 `task.json` 执行读—改—写，轮询可能用旧快照覆盖刚写入的新 Job ID，随后查询旧 ID 得到 404；不是视频文件或模型找不到。
- 新增按任务文件路径共享的异步写锁，片段提交、任务状态轮询、单片段状态同步和任务保存不再互相覆盖；提交重试时会同步清除旧错误和进度字段。
- Worker Job 确实不存在时，现在返回“保存的 Job ID 已过期，请重试该片段”的明确说明。
- 失败片段列表新增复选框、“全选失败片段”“清除选择”和“重新标注已选”，允许只重跑任意失败片段子集；原有单个 Retry、Re-run Segment 和 Re-run All 保持不变。
- 现有失败任务数据未被自动重写，也未在验证中运行真实片段推理。

### R16. JSON 编辑器隐藏语音/OCR，Event 自由文本与固定标签不一致（已解决）

- **状态：已解决**
- **完成日期：** 2026-07-26
- 原始模型结果把语音转写保存为 `[Speech] ...` Event、把 OCR 保存为带 `_textContent` 的文字对象，但 “Edit JSON” 会主动过滤两者，导致完整成功的片段仍显示 `events: []` 和 `objects: []`。
- 当前语音转写已改为独立顶层字段 `speechTranscript`，不再混入视觉 Event；页面和 Custom JSON 导出可兼容迁移历史 `[Speech] ...` 条目。JSON 编辑器保留 OCR 对象及其文字；`_recognition`、`_pipeline_errors`、`_provider_statuses` 和 `_pipeline_status` 等运行状态继续在内部任务数据中保留，但不会显示在可编辑标注 JSON 或 Custom JSON 导出中。
- 历史自由文本视觉 Event 不属于固定枚举时，事件下拉框会加入当前值作为临时选项，不再显示空白。
- 新 Qwen Event 会映射到固定事件本体；只有至少两个人都明确具有 `talking`、`speaking` 或 `chatting` 动作时才兜底生成 `conversation`，单人说话不会被强行解释为对话。
- **验证：** 新增自由文本 Event 归一化、双说话者对话兜底及单说话者不误判测试；Worker 回归测试 21/21 通过，TypeScript 类型检查与相关前端文件 ESLint 通过。

### R17. 画面中有内容但 `events` 仍为空（已解决）

- **根因 1：** 2B 模型按提示词顺序先输出较长的人物和物体数组，部分结果在到达 Event 字段前被截断。
- **根因 2：** Event 描述一旦提到未被 YOLO/LocateAnything 定位确认的 Qwen 物体，合并层会丢弃整条 Event；该策略能拦截 Butterfly 幻觉，但也会让真实可见、检测器漏检的场景没有 Event。
- **修复：** 将 `event_type` 与 `event_description` 提前到人物/物体数组之前；语音只进入 `speechTranscript`。当模型 Event 缺失或被证据过滤时，后端只根据已定位人物、人物动作和已定位非文字物体生成一条 `visual_activity` 描述，不重新引入未定位的 Qwen 物体。
- **历史数据兼容：** 审核页、JSON 编辑器和 Custom JSON 导出会对旧的空 Event 结果执行相同的确定性视觉兜底，因此无需为“显示已有证据的概括”重跑模型；若要获得新的 Qwen 描述，仍需单独重新标注该片段。
- **验证：** Worker 回归测试 21/21、TypeScript 类型检查、相关前端文件 ESLint 和 Next.js 生产构建通过；未运行新的真实片段推理。

### R18. 固定标签无法表达枚举外内容，OCR/语音误识无法人工纠正（已解决）

- **问题：** 人物、物体、场景、相机和 Event 的下拉框只能选择预设枚举；OCR 与语音转写只能查看，识别错误时只能通过完整 JSON 间接修改。
- **修复：** 所有语义标签下拉框增加“自定义…”选项，并在选中后显示文本输入框；自定义值仍写入原字符串字段，不增加新的导出结构。`Indoor` 等布尔字段保持约束，遮挡比例改为 0–1 数值输入。
- **文字纠错：** OCR 行和 `speechTranscript` 可在原审核区域直接编辑并统一保存。OCR 修正同步更新 `_textContent` 与对象 `name`；清空 OCR 会移除对应误识文字对象，清空语音会删除人工转写，历史 `[Speech] ...` Event 同时完成迁移。
- **人工结果优先：** 内部 `_humanEdited` 标记确保“删除错误结果”也被视为有效人工修改，避免空值被旧模型标注重新覆盖；该标记不会出现在可编辑或导出的标注 JSON。
- **验证：** TypeScript 类型检查、相关前端文件 ESLint、Next.js 生产构建和 Worker 回归测试 21/21 通过。在独立生产服务中完成浏览器交互检查：历史枚举外值会显示“自定义…”输入框，测试片段显示 5 个 OCR 编辑框和 1 个语音编辑框，修改后保存按钮正确启用；未点击保存，测试数据未变化。

### R19. `video.description` 只能按关键词拼接，无法语义概括整个视频（已解决）

- **状态：** 已解决
- **原问题：** 虽然 R13 已让全部片段参与描述，但实现仍只是按出现频率提取场景、人物、动作和物体后套用固定模板，无法理解片段之间的时间顺序、主题和整体事件。
- **解决方式：** Custom JSON 导出时按时间顺序汇集该视频全部有效片段的场景、已定位人物/物体、视觉 Event、OCR 和语音上下文，调用 Settings 中已有的通用 LLM 生成严格的一句话概括；超出单次提示长度的长视频会分块概括，再把各块结果归并为最终一句。
- **防幻觉约束：** 普通物体只有存在定位框时才进入总结证据；提示词禁止新增证据中不存在的人物、物体、动作、因果和结局，并把 OCR/语音视为上下文而不是画面动作。
- **兼容性：** 不重新运行视频 Worker、不下载新模型、不改变现有标注 JSON 字段结构。通用 LLM 未配置、调用失败或返回空内容时，自动回退到 R13 的本地确定性摘要并在页面提示；JSON 仍可正常下载。
- **导出语义：** 全量导出为每个视频分别生成一句话并写入对应的 `video.description`；导出当前片段时，`annotations` 仅包含当前 Segment，但外层 `video.description` 仍概括整个视频。
- **验证：** TypeScript 类型检查、新增/修改服务组件 ESLint 和 Next.js 生产构建均已通过；未调用真实外部 LLM，也未运行视频片段推理。
- **完成日期：** 2026-07-26

### R20. LocateAnything 拖慢所有片段，普通标注缺少轻量路径（已解决）

- **状态：** 已解决
- **完成日期：** 2026-07-26
- **调整方式：** 普通标注、单片段标准重跑、全部重跑和失败片段批量重试均在任务级 `providers` 选项中显式设置 `locate_anything: false`，只跳过该 Provider，不修改全局安装状态，也不影响 YOLO、tracker、Qwen、OCR、语音、Depth、审核或导出。
- **精细定位：** 片段审核工具栏新增“精细定位”，仅为当前选中的片段提交 `locate_anything: true`。后端先检查 Worker 的完整增强模式与模型准备状态；未就绪时返回明确的 `409 PRECISION_UNAVAILABLE`，不会排入一个实际未启用 LocateAnything 的任务。
- **状态与数据保护：** 页面区分“标准标注”“精细定位”和“精细定位中”；任务文件只保存运行模式元数据，不改变标注/导出 JSON schema。任务完成后仍只替换 `modelAnnotation`，已有 `humanAnnotation` 保持优先且不会被重跑覆盖。
- **保留能力：** LocateAnything 依赖、缓存复用、完整增强模式和全类别 `hybrid` 配置均保留。精细任务默认使用自适应证据类别、18 类上限和有边界的 fast-first 路径；无框时会以相同 token 上限执行 bounded hybrid 重试，可通过 `LOCATE_CATEGORY_MODE=full` 恢复完整类别列表。
- **验证：** 统一 `npm test` 通过 13 个 Node 测试、44 个 Worker 测试和 TypeScript 类型检查，Next.js 生产构建通过；新增用例覆盖任务级开关、增强模式门控和模式状态。本次调整没有启动 Worker，也没有运行新的真实模型片段，因此不宣称精细路径已经达到秒级。

### R21. React Hooks、Canvas Ref 与未使用变量阻塞全项目 ESLint（已解决）

- **状态：** 已解决
- **完成日期：** 2026-07-26
- **原问题：** 全项目 ESLint 报告 14 个错误和 9 个警告，主要是标注页在 Effect 中同步派生状态、`AnnotationCanvas` 在渲染期间读写 Ref，以及少量未使用参数；这些问题会阻塞持续集成，并可能在 React 19 严格检查下引起额外渲染或不稳定行为。
- **解决方式：** 画布图片加载、选中轨迹与窗口事件引用改为 Effect/回调管理；标注页将轨迹和片段编辑草稿收敛到带稳定 Key 的局部编辑组件，把 Pipeline 阶段改为派生值，并将删除、重跑等状态转换放回对应的用户事件或异步完成路径；项目页排序直接使用 Store 状态，不再维护重复 Ref 快照；同时移除确实未使用的参数和属性。
- **兼容性说明：** 未关闭或放宽 ESLint/React Hooks 规则，未改变标注、保存、重跑、导出、Canvas 绘制与表格排序的数据格式或对外接口；编辑草稿仍只在用户点击保存后写入任务数据。未启动 Worker，也未执行真实模型推理。
- **验证：** `npm.cmd run lint` 为 0 error、0 warning；统一 `npm.cmd test` 通过 13 个 Node 测试、44 个 Worker 测试和 TypeScript 类型检查；`npm.cmd run build` 生产构建通过。

## 3. 部分解决的问题

### A1. 视频项目卡片已经接入缩略图，但页面仍可能只显示占位图

- **优先级：P1**
- **现状：** `app/annotations/[annotateId]/page.tsx` 已请求 `/api/video-annotation/files/{videoId}?t=0.1`，文件 API 也会调用 ffmpeg 提取并缓存帧；提取失败时会返回 1×1 占位 JPEG，因此前端表面上仍像“没有首页图片”。
- **风险：** 当前失败响应仍为 HTTP 200，`Image.onError` 不一定触发，真实错误被占位图掩盖。
- **解决方案：**
  1. 验证运行 Worker/Next.js 进程能找到 `ffmpeg`；
  2. 对空帧、1×1 占位和无效时间点返回明确错误状态或专用占位标识；
  3. 上传完成后异步生成固定封面文件，而不是首次打开卡片时临时提取；
  4. 优先选择 0.5～1 秒或视频有效区间内的首个可解码帧。
- **验收标准：** MP4、MOV、MKV、WebM 测试视频均显示真实封面；ffmpeg 缺失时页面显示明确错误而不是空白区域。

### A2. 模型缓存复用已实现，但磁盘占用仍需可观测和治理

- **优先级：P2**
- **现状：** 可以识别缓存和本地模型路径，但目前缺少前端缓存清单、模型版本/大小对比和安全清理入口。
- **解决方案：** 展示模型 ID、revision、实际路径、占用空间和最后使用时间；清理前检查是否被当前配置引用，并要求二次确认。
- **验收标准：** 相同 revision 不重复下载；不同缓存根路径能被明确识别；清理操作不会删除正在使用或用户手动配置的目录。

### A3. pipeline 抽取了三张语义关键帧，但 Qwen 实际只读取第一张

- **优先级：P1**
- **现状：** `pipeline.py` 默认抽取 3 张关键帧并全部传给语义 Provider，但 `providers/semantic/qwen_vl.py` 使用 `frame_paths[0]`，动作过程和后续场景信息丢失。
- **解决方案：** 将三张图按时间顺序一次性传给 Qwen，提示词明确“开始/中间/结束”，限制只能输出有画面依据的 JSON；控制分辨率和视觉 Token。
- **验收标准：** 固定测试集上动作、事件和短暂出现目标的识别优于单帧基线，JSON 合法率不得下降。

## 4. P0 处理结果与待解决问题

## P0：代码侧问题已处理，外部旧密钥撤销仍需部署者确认

### P0-1. 同一帧可能出现重复 `trackId`（已解决）

- **完成日期：** 2026-07-23
- **原现象：** 两个检测框可能被分配同一个 `trackId`。
- **根因：** 当前所谓 `ByteTrackTracker` 实际是简单 IoU tracker；一个活跃轨迹在当前帧匹配成功后没有被标记为已占用，因此可再次匹配当前帧的另一个检测框。
- **位置：** `workers/video-annotation/providers/tracker/bytetrack.py`。
- **已实施：** 每帧维护已占用轨迹集合；已有轨迹和本帧新建轨迹一旦分配便不能再次匹配当前帧其他检测框。增加回归测试复现两个高度重叠人物争用同一轨迹的情况。
- **验证结果：** 任意一帧内输出 ID 唯一；相关单元测试通过。
- **后续状态：** 当时保留的 Hungarian assignment、运动预测和完整 ByteTrack 已于 2026-07-26 在 P1-3 中实现；本条继续记录最初 P0 修复的边界。

### P0-2. 不同片段的 `trackId` 都从 1 重新开始，不是视频级唯一（已解决）

- **完成日期：** 2026-07-23
- **原现象：** 每个片段都有 Track 1、Track 2，导出后无法仅凭 `trackId` 定位视频中的唯一轨迹。
- **根因：** 每个片段独立创建、加载和卸载 tracker；`track()` 与 `unload()` 都会清空状态并把 `_next_id` 重置为 1。
- **已实施：**
  1. 新增 `workers/video-annotation/services/video_identity.py` 视频级注册表；
  2. `trackId` 保持数字类型，局部 ID 在进入深度、合并、审核和导出前映射为视频级 ID；
  3. 同一片段重跑复用已保存映射；
  4. 仅对时间相邻、类别一致、边界 IoU 达到阈值的一对一轨迹延续全局 ID；
  5. 注册表不可用时使用确定性的片段命名空间回退，仍不产生跨片段碰撞；
  6. Next.js 提交标注任务时传递 `video_id` 和 `segment_id`，未改变公开页面和标注字段类型。
- **验证结果：** 单元测试覆盖相邻片段一对一延续、同片段重跑和回退命名空间；真实视频的 YOLO + tracker 最小流程无 pipeline 错误且 ID 唯一。
- **兼容性：** 现有历史标注不会自动重写；重新标注片段后使用新 ID。删除 `data/video-annotations/cache/video-identities/` 会重置尚未固化到标注结果中的注册表状态。

### P0-3. 当前 `personId` 不是可靠的人物身份（已解决不安全重复，跨镜头 ReID 留待后续）

- **完成日期：** 2026-07-23
- **原现象：** 相似性别、年龄、发色和衣着的人会得到相同 `personId`；同一个人物的属性识别波动又会产生不同 ID。
- **根因：** `qwen_vl.py::_make_person_id()` 仅对语义属性字符串计算短 MD5；语义人物又按列表顺序与检测轨迹对应，而非空间或外观匹配。
- **已实施：** 删除语义属性 MD5 身份生成；`personId` 改由视频级轨迹生成，格式为 `<videoId>:person:<trackId>`。连续片段只有边界一对一高置信匹配时延续身份，不确定时创建新身份。
- **验证结果：** 同一片段的多人 `personId` 唯一，语义属性相同不再导致身份碰撞；同一片段重跑保持稳定。
- **明确限制：** 本次没有引入人脸/人体 embedding，也没有自动跨硬切镜头合并。人物长时间离开或跨镜头返回时可能得到新 ID，这是避免误合并的保守策略。生产级跨镜头 ReID、置信度字段和人工合并/拆分入口转为 P1-5。

### P0-4. ffmpeg 抽帧失败时异常处理自身崩溃（已解决）

- **完成日期：** 2026-07-23
- **原现象：** `subprocess.run(..., encoding="utf-8")` 返回的 `stderr` 已是字符串，但异常处理中仍调用 `e.stderr.decode()`，会掩盖原始 ffmpeg 错误。
- **位置：** `workers/video-annotation/services/frame_sampling.py`。
- **已实施：** 兼容 `str | bytes | None`，保留安全截断后的 ffmpeg 错误，使用异常链保留根因，并清理由该调用创建的临时目录。
- **验证结果：** 模拟字符串 `stderr` 时返回包含原始信息的 `RuntimeError`，不会再出现 `.decode()` 二次异常，临时目录已清理。

### P0-5. 撤销所有曾暴露的旧 Token/密钥（仓库侧完成，外部操作待确认）

- **仓库扫描结果：** 当前工作区未发现 Hugging Face Token；Git 可达历史未发现 Hugging Face 或常见 `sk-...` 密钥模式。`project_tree.txt` 的命中是文件名误报。被 `.gitignore` 排除的 `configs/llm-config.json` 含当前本地 LLM API Key，该文件未出现在 Git 历史中，保留它是为了不破坏当前本地配置。
- **仍需部署者操作：** 在 Hugging Face 和对应 LLM 平台撤销任何曾暴露的旧 Token，生成最小权限的新 Token，并检查无法由仓库扫描覆盖的终端记录、截图、日志和共享压缩包；生产部署改用 Secret Manager。
- **验收标准：** 旧 Token 调用返回未授权；仓库历史和当前工作树不包含有效密钥；新 Token 仅具有必要权限。

### P0-6. 完整增强模式的 `LocateAnything-3B` 全量失效但任务仍显示完成（已解决）

- **确认日期：** 2026-07-24；完成日期：2026-07-26
- **现象：** `ign` 测试任务的 62 个片段虽然最终均显示 `completed`，但 62/62 都包含 `LocateAnything grounding failed`。完整增强模式接口仍把模型报告为 `ready`，用户无法从项目状态看出精细物体定位实际没有参与推理。
- **根因：** 原 Worker 环境安装 `transformers 5.14.1`，而已缓存的 NVIDIA LocateAnything 模型说明指定 `transformers==4.57.1`。Transformers 5.x 调用 `_check_and_adjust_attn_implementation(..., allow_all_kernels=...)`，模型远程代码仍使用旧签名，因而在加载阶段报 `unexpected keyword argument 'allow_all_kernels'`。原依赖只限制为 `transformers>=4.46,<6`，范围过宽；启动脚本还可能回退到共享 Conda 环境，使一个项目的修复影响其他项目。
- **影响：** 开放词汇物体定位整层被跳过，结果退化为 `yolo11n` 的有限 COCO 类别和 Qwen 语义输出；与此同时，防幻觉合并规则又会丢弃没有定位框的 Qwen 单独物体，造成明显漏识。
- **已实施修复：**
  1. `transformers` 在 Worker 的所有相关依赖配置中固定为 `4.57.1`；LocateAnything Provider 显式声明该版本要求。
  2. `setup-video-worker.ps1` 创建项目内 `workers/video-annotation/.venv`，启动脚本不再回退到共享 Conda/base 环境；当前 Windows 环境已验证 `torch 2.13.0+cu132`、`torchvision 0.28.0+cu132`、CUDA 可用。共享 `yolo` 环境未被修改。
  3. Provider 状态在依赖版本不兼容时返回 `incompatible_dependency`，模型准备会在下载前终止，避免“缓存存在即 ready”和无意义重复下载。
  4. Pipeline 写入 `_provider_statuses` 与 `_pipeline_status`。启用的核心视觉 Provider 失败时保留可用结果，但 API、片段、视频、项目和审核页统一显示 `partial_completed`，并支持定向重新标注；带已知核心错误的历史结果在读取时也会归一化。
  5. 按模型官方安装说明补齐并固定 `peft==0.19.1`、`decord==0.6.0`、`lmdb==1.7.5`，这些小型 Python 运行库安装在 Nuwa `.venv`，模型权重继续复用 `D:/dev/models/huggingface`，没有重复下载。
  6. 移除 Provider 强制设置的 `_attn_implementation="eager"`，改用模型实现明确支持的 `attn_implementation="sdpa"`；未安装可选 FlashAttention/MagiAttention 时自动回退 SDPA。
- **真实验证：** 对 `test` 项目第一个视频的 `S1`（0–8 秒）单独重标，Job `2c56adce2cb6` 最终为 `completed`，没有 `_pipeline_errors`；YOLO、tracker、LocateAnything、Qwen 均为 `completed`，完整 Pipeline 也为 `completed`。结果包含 3 个人、5 个 OCR 文字对象和 1 条语音转写；该语音现通过独立 `speechTranscript` 字段表达。
- **自动验证：** 隔离环境依赖检查无破损、CUDA 可用；Worker 回归测试 21/21、TypeScript 类型检查及相关前端文件 ESLint 通过。
- **历史数据说明：** 原 `ign` 与其他旧结果不会自动重新推理，读取时仍会按旧 `_pipeline_errors` 显示 `partial_completed`；需要由用户选择受影响片段重新标注。

### P0-7. 核心 Provider 失败或禁用时 Pipeline 状态仍可能误判（已解决）

- **完成日期：** 2026-07-26
- **原现象：** Qwen 推理异常或输出无法解析的 JSON 时，Provider 返回一个空语义对象，Pipeline 随后把 Qwen 标为 `completed`；tracker 真正抛错时又未参与最终降级判定。反过来，主动禁用 YOLO 或 Qwen 也会被固定的必需 Provider 列表错误判为降级。
- **根因：** `qwen_vl.py` 的宽泛异常处理把错误吞掉并返回 `_empty()`；Pipeline 的最终状态列表写死为 YOLO、Qwen 和条件启用的 LocateAnything，遗漏 tracker，也没有统一按实际启用配置判断。
- **已实施修复：**
  1. Qwen 推理异常及空/无效解析结果现在抛出明确错误，由 Pipeline 写入 `_pipeline_errors` 和 `qwen_vl: failed`，不再伪装为空结果成功。
  2. 最终状态按 YOLO、tracker、LocateAnything、Qwen 的实际启用状态统一判断；启用后真正失败或缺少必需输入会得到 `partial_completed`。
  3. 主动禁用的 Provider 不参与降级判定；检测阶段正常没有目标而使 tracker 以 `no_detections` 跳过，也不会被误判为失败。
- **边界保持：** 未改变模型、权重、阈值、抽帧、合并、人工标注或导出逻辑；OCR、语音和深度的既有可选阶段状态语义保持不变。
- **自动验证：** 新增 Qwen 推理异常、无效/空 JSON、tracker 失败、tracker 无目标跳过和 Provider 主动禁用回归测试；Worker 回归测试 27/27 通过，未运行真实视频推理。

## P1：当前迭代处理

### P1-1. Qwen3-VL-4B-Instruct INT4 升级尚未实现

- **现状：** 当前仍通过 BF16 加载 Qwen3-VL-2B，且没有 `bitsandbytes` INT4 配置。直接把模型名改为 4B，在 8GB RTX 5060 Laptop GPU 上很可能 OOM。
- **解决方案：**
  1. 先完成三关键帧输入并建立 2B 新基线；
  2. 增加 NF4 4-bit 加载、BF16 compute dtype、OOM 捕获和 2B 回退；
  3. 控制每张图的分辨率/视觉 Token；
  4. 确保不同 Provider 顺序加载并彻底卸载；
  5. 用 50～100 个固定片段比较 2B 单帧、2B 三帧、4B INT4 三帧。
- **验收标准：** 峰值显存稳定低于设备上限且连续批量任务无 OOM；字段准确率和 JSON 合法率优于当前基线；失败时能够自动回退并留下明确诊断。

### P1-2. 大文件上传会整体进入 Node 内存（代码侧已解决）

- **完成日期：** 2026-07-26
- **原问题：** 路由先调用 `req.formData()` 和 `file.arrayBuffer()`，即使随后使用 `pipeline()`，大文件仍会完整进入 Node.js 内存。
- **已实施：** 上传接口改为使用 Busboy 直接解析原始 multipart 请求流；视频内容边接收边写入 `source.tmp`、增量计算 SHA-256，并在完成后原子重命名。格式错误、超过 2GB、客户端中断或写入失败时会等待流关闭并清理临时文件及本次新建目录。
- **兼容性：** 前端仍提交原有 `multipart/form-data`，成功响应字段和最终 `source.<ext>` 路径保持不变；未修改已有上传视频。
- **自动验证：** Node 回归测试覆盖流式写入、SHA-256、精确上限、超限清理、非法扩展名、畸形 multipart 和输入中断清理；尚未在当前机器实际传输 2GB 文件，部署规模的峰值内存记录保留为人工压力验收。

### P1-3. 接入真正的 ByteTrack（已实现，待真实视频基准）

- **完成日期：** 2026-07-26
- **已实施：** 默认后端改为 Ultralytics ByteTrack，使用 Kalman 预测、轨迹生命周期和高低置信度两阶段关联；`lap 0.5.13` 安装在 Nuwa 隔离 `.venv`。按类别维护独立 Tracker，导出时映射为同一片段内唯一 `trackId`，接口继续输出原 `FrameTrack` 结构。
- **精度保护：** YOLO 仅在 ByteTrack 启用时保留最低 `0.1` 的跟踪候选；默认 `0.65` 高阈值仍用于创建新轨迹，低置信度框只能维持已确认轨迹，不能单独成为新导出对象。
- **回退：** `NUWA_TRACKER_BACKEND=iou` 可恢复旧的确定性 IoU Tracker；相关阈值和 buffer 均可在 `worker.env` 配置。
- **自动验证：** 合成检测测试覆盖低置信度框不能新建轨迹、可以维持已确认轨迹、不同类别导出 ID 唯一和旧 IoU 同帧唯一性。
- **待人工验收：** 未运行真实视频推理；仍需由用户在遮挡、快速移动、短暂丢失和多人交叉样本上比较 ID switch、耗时与旧后端。跨硬切镜头 ReID 仍属于 P1-5。

### P1-4. 缺少针对视频主流程的自动化回归测试（主要入口已解决）

- **完成日期：** 2026-07-26
- **已实施：** `package.json` 新增 `npm test` 统一入口，顺序执行 Node 测试、项目隔离 Worker 的 Python `unittest` 和 TypeScript 类型检查；另提供 `test:node`、`test:worker` 与 `typecheck`。
- **覆盖范围：** 10 个 Node 测试覆盖流式上传、目录碰撞保护及人工标注保留；34 个 Worker 测试覆盖 Provider 状态、Qwen 失败传播、ByteTrack 两阶段关联与延迟首次出现、视频身份、ffmpeg 错误、OCR、YOLO 阈值与语义合并。
- **人工标注保护：** Worker 重跑成功后只更新 `modelAnnotation`，不再删除 `humanAnnotation`；新模型诊断和人工确认版本分开保存。
- **当前边界：** 统一测试入口不加载模型、不处理真实视频；完整的真实模型浏览器端到端、2GB 压力和通用数据迁移测试仍需要单独受控环境，不能把它们误报为已自动覆盖。
- **Lint 说明：** 本条最初记录的全项目 14 个 React Hooks/Refs 错误和 9 个警告已在 R21 中独立解决；没有关闭或放宽规则。当前 `npm.cmd run lint` 为 0 error、0 warning。

### P1-5. 跨硬切镜头人物 ReID 与人工校正

- **现状：** 视频级注册表只延续时间相邻、边界框高置信匹配的轨迹；硬切镜头、长时间遮挡或人物离开后返回时会保守地产生新 `personId`。
- **解决方案：** 在独立基准集上评估人体外观 embedding、服装和可选人脸特征；仅高置信度自动合并，保存置信度和依据，并增加人工“合并人物/拆分人物”操作。若使用人脸特征，必须明确本地存储和删除策略。
- **验收标准：** 错误合并率优先低于错误拆分率；人工确认结果在模型重跑后不被覆盖。

### P1-6. 人物/物体识别召回率下降且仍存在误识

- **确认日期：** 2026-07-24
- **现状证据：** `ign` 的 62 个片段中只有 23 个片段包含人物，共 43 个人物轨迹；排除 OCR 文字后只保留 1 个普通物体，并被识别为置信度 `0.6855` 的 `baseball glove`。另有 16 个片段没有人物或普通物体结果。该现象主要发生在检测和合并阶段，不是最近的前端状态同步改动导致。
- **原因组合：** 当前基础检测使用速度优先的 `yolo11n`，默认采样率仅 `0.5 FPS`、置信度阈值为 `0.65`；Qwen 防幻觉提示词要求不确定或较小目标直接省略；合并层会丢弃所有无定位证据的 Qwen 单独物体。LocateAnything 失效后，这些保守策略缺少精细定位证据支撑，于是同时出现真实目标漏掉、少量 YOLO 边缘误检被当作确定结果的问题。
- **短片段问题：** 当前任务有 7 个片段发生基础抽帧失败，片段长度集中在 `0.04～0.96` 秒。`0.5 FPS` 对这类片段可能无法产生检测帧；当前 `extract_frames()` 也没有“至少抽取中点一帧”的兜底。
- **解决方案：** 在 P0-6 恢复后再建立基线；采用自适应采样并保证每个非空片段至少有一张中点检测帧，合并或抑制过短场景片段；比较 `yolo11n` 与 `yolo11s` 的准确率、耗时和显存；将 Qwen 单独声明保留为待验证候选，通过多关键帧一致性、定位 Provider 或人工确认升级为确定对象，而不是全部接受或全部丢弃；多人语义属性改为空间/外观关联，避免继续按数组顺序错配。
- **验收标准：** 使用固定的快速镜头、多人、小目标和无目标负样本集，分别记录人物/物体 precision、recall、误检数、漏检数和片段失败率；在不重新引入跨视频 `butterfly` 幻觉的前提下，召回率显著优于当前基线；任意正时长片段至少有一张有效检测帧或明确的不可处理原因。

### P1-7. LocateAnything grounding 在 8GB GPU 上异常缓慢（普通流程已规避，精细路径仍受硬件限制）

- **确认日期：** 2026-07-26
- **现象证据：** 一个 2560×1440、约 5 秒的片段在 `LocateAnything grounding` 停留十多分钟；运行期间 GPU 持续 100%，显存约 `7886 / 8151 MiB`。部署接口显示 `downloadRequired: false`，因此不是重复下载模型。
- **根因：** 原 Provider 使用通用 `model.generate()` 执行 hybrid 解码，同时将画面缩放到最长边 1280；在缺少可选 FlashAttention/MagiAttention 的 8GB Windows GPU 上，SDPA 路径接近显存上限。页面阶段名还把模型加载和推理合并显示，无法区分两部分耗时。
- **已实施：**
  1. 本地模型快照包含 NVIDIA 发布的 `batch_utils` 时自动使用官方优化 hybrid 执行器；不存在时保留原生推理路径，不新增模型下载。
  2. 输入最长边默认改为官方运行时一致的 1024，原始坐标仍按源图尺寸还原；可通过 `LOCATE_MAX_SIDE` 调整。
  3. 类别提示改用官方 `</c>` 分隔符，保留原类别列表、hybrid 模式、512 token 上限、合并逻辑和 JSON 输出结构。
  4. 新增模型加载和实际 grounding 分段耗时日志；`LOCATE_GENERATION_MODE=fast` 仅作为显式可选项，默认不以牺牲复杂场景精度换速度。
  5. Provider 卸载时清除官方执行器持有的模型全局引用并释放 CUDA 缓存，避免影响后续 Qwen、OCR 和深度阶段。
  6. 普通标注任务在任务级关闭 LocateAnything，避免每个片段都进入数分钟 grounding；主动禁用不会造成 `partial_completed`。
  7. 审核页提供当前片段“精细定位”，仅在完整增强模式和模型都就绪时排队；标准/精细模式写入内部任务状态，人工审核结果继续保留。
  8. 精细任务默认从 YOLO/Qwen 证据中选取最多 18 个类别并使用 256 token 的 fast-first 路径；无定位框时执行一次同边界 hybrid 重试，完整类别模式仍可显式恢复。
- **自动验证：** 新增类别分隔、等比例缩放、官方运行时选择及释放测试；统一 `npm test` 当前通过 13 个 Node 测试、44 个 Worker 测试和 TypeScript 类型检查。
- **真实验证：** 仅重新运行一个 2560×1440、5.04 秒片段（Job `1ff6ccf0e76a`）。官方优化执行器成功完成 LocateAnything，并输出 `man`、`adult`、`clothing` 定位结果；随后 Qwen、OCR、语音检查和 Depth 均继续完成，最终 `_provider_statuses.locate_anything` 与 `_pipeline_status` 都为 `completed`，队列归零。Locate 阶段峰值约 `7890 / 8151 MiB`，卸载后降至约 208 MiB，未影响后续 Provider。
- **剩余边界：** 本机没有 FlashAttention/MagiAttention，70 多个默认类别的 `hybrid` 解码仍为数分钟级，不能宣称已经达到秒级。NVIDIA 的基准使用 A100/H100，并明确指出 SDPA 功能完整但更慢；当前 Windows/Python 3.13/CUDA 13.2 环境没有经过验证的即装即用 FlashAttention 组合，因此没有为追求速度安装不确定的非官方 wheel。普通任务已不再承担这段等待，但精细定位仍可能较慢；新的自适应 fast-first 路径只有自动化回归验证，尚未做新的真实模型速度/准确率验收。

## P2：后续迭代处理

### P2-1. 片段、轨迹和人物结果缺少版本化迁移

- 为标注 JSON 增加 `schemaVersion`、模型 revision、pipeline 配置摘要和生成时间。
- 重新标注现已保留整个 `humanAnnotation`，不再静默删除人工确认结果；模型 revision、配置摘要、变更级合并和通用迁移机制仍待实现。

### P2-2. 场景切分默认阈值需要数据集校准

- 当前阈值映射可能导致切换检测过于迟钝；应使用典型视频集评估漏切和过切，而不是直接凭经验改默认值。
- 验收指标至少包含场景边界准确率、平均片段长度和人工修正次数。

### P2-3. 深度估计使用固定焦距，绝对深度可信度有限

- 当前固定 `FOCAL_LENGTH_PX = 800.0`，不同相机和分辨率下误差不可控。
- 如果无法获得相机内参，应明确标记为相对深度，不应作为真实米制距离展示或导出。

### P2-4. API 输入模型、限流和安全响应头仍需补齐

- Worker `/jobs` 等接口应使用 Pydantic 模型校验输入范围。
- 对上传、LLM 调用和模型准备接口增加并发/频率限制。
- 增加适合部署环境的 CSP、`X-Content-Type-Options`、frame policy 等安全头；启用 HTTPS 时再配置 HSTS。

### P2-5. Python 依赖缺少可复现锁文件

- 开发配置可保留兼容范围；稳定部署应生成经过验证的锁文件或镜像，并记录 CUDA、PyTorch 和 Transformers 组合。

### P2-6. 新旧视频标注路由并存，存在维护分叉风险

- 当前可见新路由 `/annotations/...`，同时仍保留 `/project/[id]/annotate/...` 代码。
- 确认兼容期后统一数据入口和页面实现，旧路由使用显式重定向，避免同一功能修两套页面。

## P3：工程整理

- 清理已废弃函数、错误的 Phase 编号和乱码注释。
- 统一 Provider 的 GPU 缓存释放、错误结构和日志字段。
- 统一 LZO stub 行为。
- 删除不应跟踪的 `__pycache__`、IDE 文件和临时项目树文件；操作前确认哪些属于开发者刻意保留的文件。
- 为本文每次状态变化补充日期、关联提交和验证结果。

## 5. 推荐执行顺序

1. **核心视觉链路扩展回归：** 在更多代表性片段上抽样验证 LocateAnything 精度、耗时和显存，不批量重跑全部历史数据。
2. **外部安全操作：** 确认 Hugging Face/LLM 后台旧密钥已撤销，并换成最小权限凭据。
3. **识别准确率：** 建立当前基线 → 自适应抽帧和短片段兜底 → 平衡 Qwen 候选证据 → YOLO 模型/阈值 A/B 测试 → 2B 三关键帧与 4B INT4 对比。
4. **稳定性：** 2GB 上传压力验收 → 缩略图错误可观测 → 真实模型浏览器端到端测试。
5. **人物身份增强：** 跨镜头 ReID 基准 → 身份置信度 → 人工合并/拆分。
6. **部署与维护：** 缓存治理、依赖锁定、API 限流/校验、旧路由收敛和代码清理。

## 6. 每项修改的统一验收清单

- [ ] 不改变合成数据模块原有功能和数据格式，除非变更有单独迁移说明。
- [ ] 现有视频标注项目和人工标注可以继续打开、编辑和导出。
- [ ] 新增字段保持向后兼容；旧数据缺少字段时有明确默认值。
- [ ] 前端 lint、TypeScript 构建、Python 单元测试通过。
- [ ] 使用至少一个短视频完成：上传 → 切分 → 标注 → 人工编辑 → 状态同步 → 导出。
- [ ] 使用多人物、遮挡、跨镜头视频验证 Track/Person 身份。
- [ ] 使用 8GB 显卡连续处理多个片段，记录峰值显存、耗时和 OOM 情况。
- [ ] 日志、API 响应、导出文件和截图均不包含 Token/API Key。
- [ ] 更新本文状态、验证日期和关联提交。

## 7. 状态更新模板

完成问题后不要直接删除条目，应移动到“已解决”并补充：

```markdown
### Rxx. 问题标题

- 状态：已解决
- 原问题：
- 解决方式：
- 兼容性说明：
- 验证命令/场景：
- 完成日期：YYYY-MM-DD
- 关联提交：<commit hash 或待提交>
```

## 8. 2026-07-23 P0 验证记录

| 验证项 | 结果 |
| --- | --- |
| Worker 回归测试 | 16/16 通过；使用实际 Worker 的 `yolo` Python 环境验证（不运行真实媒体推理） |
| Python 语法编译 | `python -m compileall -q .` 通过 |
| TypeScript 类型检查 | `node node_modules/typescript/bin/tsc --noEmit` 通过 |
| 本次修改的 API 路由 ESLint | 通过 |
| 生产构建 | `npm.cmd run build` 通过；全部页面和 API 路由成功生成 |
| 真实视频最小流程 | YOLO + tracker 处理成功，`trackId/personId` 唯一且无 pipeline error |
| Worker 运行状态 | 已重启，`127.0.0.1:8765/health` 返回 `status=ok`、`device=cuda`、队列为空 |
| 密钥扫描 | 当前工作区无 Hugging Face Token；Git 可达历史无匹配密钥；本地忽略配置中的 LLM Key 未输出、未改动 |

> 后续状态（2026-07-26）：本节保留的是 2026-07-23 当时的验证快照；其中记录的前端 React Hooks/Refs 和未使用变量问题已在 R21 中独立解决，当前全项目 ESLint 为 0 error、0 warning。
